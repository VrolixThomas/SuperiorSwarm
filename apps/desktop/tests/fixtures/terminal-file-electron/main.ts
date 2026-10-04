import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, app, ipcMain, session } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { registerTerminalInputIPC } from "../../../src/main/terminal/input-ipc";
import { terminalFileOwners } from "../../../src/main/terminal/terminal-files";
import { terminalFilesRouter } from "../../../src/main/trpc/routers/terminal-files";
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
	ipcMain.handle("fixture:files", async (_event, method: string, input: unknown) => {
		const api = terminalFilesRouter.createCaller({ fileCaller: caller });
		switch (method) {
			case "prepare":
				return api.prepare(input as Parameters<typeof api.prepare>[0]);
			case "append":
				return api.append(input as Parameters<typeof api.append>[0]);
			case "resolve":
				return api.resolve(input as Parameters<typeof api.resolve>[0]);
			case "insert":
				return api.insert(input as Parameters<typeof api.insert>[0]);
			case "cancel":
				return api.cancel(input as Parameters<typeof api.cancel>[0]);
			default:
				throw new Error("Unsupported fixture operation");
		}
	});
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
	// Chromium supplies real File objects; preload must resolve them through webUtils.
	await contents.debugger.sendCommand("DOM.setFileInputFiles", { nodeId, files: [paths[0]] });
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
		contents.executeJavaScript("document.body.textContent.includes('Paths added to your prompt')")
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
		contents.executeJavaScript("document.body.textContent.includes('Paths added to your prompt')")
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
