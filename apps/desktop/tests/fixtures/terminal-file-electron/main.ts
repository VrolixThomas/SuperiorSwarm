import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, app, ipcMain, session } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { registerTerminalInputIPC } from "../../../src/main/terminal/input-ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { terminalFileOwners } from "../../../src/main/terminal/terminal-files";
import { router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { terminalFilesRouter } from "../../../src/main/trpc/routers/terminal-files";
import type { DaemonMessage } from "../../../src/shared/daemon-protocol";
import { formatFilePaths } from "../../../src/shared/terminal-files";

const root = process.env["SS_FIXTURE_ROOT"];
if (!root) throw new Error("Fixture root required");
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setPath("crashDumps", join(root, "profile"));
app.setAppLogsPath(join(root, "profile", "logs"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-networking");
const manager = new PtyManager();
const socketPath = join(root, "fixture.sock");
const server = new SocketServer(
	manager,
	{ flush: () => [] } as unknown as ScrollbackStore,
	socketPath
);
const legacy = process.env["SS_FIXTURE_DAEMON"] === "legacy";
if (legacy) {
	const transport = server as unknown as { send: (socket: Socket, message: DaemonMessage) => void };
	const send = transport.send.bind(server);
	transport.send = (socket, message) =>
		send(socket, message.type === "ready" ? { type: "ready", protocolVersion: 2 } : message);
}
const client = new DaemonClient(socketPath, join(root, "pid"), join(root, "log"));
const id = "fixture-terminal";
const capture = join(root, "input");
let window: BrowserWindow | undefined;
let step = "startup";

async function until(condition: () => boolean | Promise<boolean>) {
	for (let attempt = 0; attempt < 300; attempt++) {
		if (await condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Fixture condition timed out");
}
async function run() {
	await app.whenReady();
	session.defaultSession.webRequest.onBeforeRequest((details, done) => {
		done({ cancel: !details.url.startsWith("file://") && !details.url.startsWith("devtools://") });
	});
	server.listen();
	await client.connect();
	setDaemonClient(client);
	window = new BrowserWindow({
		show: false,
		width: 900,
		height: 600,
		webPreferences: {
			preload: join(root!, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	const contents = window.webContents;
	rendererTrust.register(contents.id, pathToFileURL(join(root!, "index.html")).href);
	setupTRPCIPC(router({ terminalFiles: terminalFilesRouter }));
	const caller = { senderId: contents.id, frameId: contents.mainFrame.routingId };
	ipcMain.handle("fixture:create", async (_event, terminalId: string) => {
		if (terminalId !== id) throw new Error("Unexpected terminal");
		terminalFileOwners.attach(id, caller, "fixture-workspace", root!);
		await client.create(
			id,
			root!,
			(data, meta) => contents.send("fixture:data", id, data, meta),
			(code) => contents.send("fixture:exit", id, code)
		);
		return { wasAttached: false };
	});
	registerTerminalInputIPC(ipcMain, client, undefined, (terminalId, data, binary) => {
		if (!binary && /[\r\n]/.test(data))
			terminalFileOwners.invalidate(terminalId, "submitted input");
	});
	ipcMain.handle("fixture:resize", (_event, terminalId: string, cols: number, rows: number) =>
		client.resize(terminalId, cols, rows)
	);
	await window.loadFile(join(root!, "index.html"));
	step = "TUI ready";
	await until(() => manager.getBuffer(id).includes("FIXTURE_READY"));
	await until(() =>
		contents.executeJavaScript("!!document.querySelector('.xterm-helper-textarea')")
	);
	const target = await client.fileTarget(id);
	if (!target?.supported) throw new Error("Native versioned fixture was not recognized");
	const paths = [join(root!, "first file.pdf"), join(root!, "second's.mov"), join(root!, "雪.txt")];
	contents.debugger.attach("1.3");
	const { root: documentRoot } = await contents.debugger.sendCommand("DOM.getDocument");
	const { nodeId } = await contents.debugger.sendCommand("DOM.querySelector", {
		nodeId: documentRoot.nodeId,
		selector: 'input[type="file"]',
	});
	// A native drag supplies real File objects and only advertises copy, as some
	// macOS drag sources do. Exercise drop handling rather than the file picker.
	const dropPoint = await contents.executeJavaScript(`(() => {
		const rect = document.querySelector('.xterm-screen').getBoundingClientRect();
		return {x: rect.x + 40, y: rect.y + 40};
	})()`);
	for (const type of ["dragEnter", "dragOver", "drop"]) {
		await contents.debugger.sendCommand("Input.dispatchDragEvent", {
			type,
			...dropPoint,
			data: { items: [], files: [paths[0]], dragOperationsMask: 1 },
		});
	}
	step = "first selection";
	await until(() =>
		contents.executeJavaScript("document.body.textContent.includes('1 file added')")
	);

	if (readFileSync(capture, "utf8") !== "") throw new Error("Selecting files wrote terminal input");
	await contents.executeJavaScript("document.querySelector('.xterm-helper-textarea').focus()");
	const enter = () => {
		contents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
		contents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
	};
	const type = (text: string) => {
		for (const char of text) contents.sendInputEvent({ type: "char", keyCode: char });
	};
	type("look at");
	step = "first draft";
	await until(() => readFileSync(capture, "utf8") === "look at");
	enter();
	const first = `look at\x1b[200~${formatFilePaths([paths[0]!])}\x1b[201~`;
	step = "first insertion without submit";
	await until(() => readFileSync(capture, "utf8").length >= first.length);
	if (readFileSync(capture, "utf8") !== first)
		throw new Error("First Enter must only insert paths, without CR");
	await until(() =>
		contents.executeJavaScript("!document.querySelector('[aria-label=\"Files in this message\"]')")
	);
	type("then compare with");
	const prose = `${first}then compare with`;
	await until(() => readFileSync(capture, "utf8") === prose);
	await contents.debugger.sendCommand("DOM.setFileInputFiles", { nodeId, files: paths.slice(1) });
	step = "second selection";
	await until(() =>
		contents.executeJavaScript("document.body.textContent.includes('2 files added')")
	);
	if (readFileSync(capture, "utf8") !== prose)
		throw new Error("Second selection wrote terminal input");
	enter();
	const draft = `${prose}\x1b[200~${formatFilePaths(paths.slice(1))}\x1b[201~`;
	step = "second insertion without submit";
	await until(() => readFileSync(capture, "utf8").length >= draft.length);
	if (readFileSync(capture, "utf8") !== draft)
		throw new Error("Second batch must only insert paths, without CR");
	await until(() =>
		contents.executeJavaScript("!document.querySelector('[aria-label=\"Files in this message\"]')")
	);
	enter();
	step = "separate submit";
	await until(() => readFileSync(capture, "utf8").includes("\r"));
	if (readFileSync(capture, "utf8") !== `${draft}\r`)
		throw new Error("Only Enter with no pending files should submit");

	writeFileSync(
		join(root!, "result.json"),
		JSON.stringify({
			supported: true,
			nativeFiles: 3,
			zeroBytesOnSelection: true,
			exactOrderedPaste: true,
			explicitEnter: true,
			twoStepEnter: true,
			interleavedDraft: true,
		})
	);
}
void run()
	.then(() => {
		window?.destroy();
		client.disconnect();
		server.close();
		manager.disposeAll();
		app.exit(0);
	})
	.catch(async (error: Error) => {
		writeFileSync(
			join(root, "result.json"),
			JSON.stringify({
				error: error.message,
				step,
				dom: await window?.webContents.executeJavaScript("document.body.innerText.slice(-1500)"),
				bytes: existsSync(capture) ? readFileSync(capture, "utf8") : "",
			})
		);
		window?.destroy();
		client.disconnect();
		server.close();
		manager.disposeAll();
		app.exit(1);
	});
