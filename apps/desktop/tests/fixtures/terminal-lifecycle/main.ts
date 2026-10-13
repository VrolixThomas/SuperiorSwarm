import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { type Socket, connect, createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, app } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { initializeDatabase } from "../../../src/main/db";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setupTerminalIPC } from "../../../src/main/terminal/ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
const dir =
	process.env["SS_FIXTURE_ROOT"] ??
	(() => {
		throw Error("Missing fixture directory");
	})();
const legacy = process.env["SS_LEGACY"] === "1";
app.setPath("userData", join(dir, "profile"));
app.disableHardwareAcceleration();
app.dock?.hide();
const manager = new PtyManager();
const server = new SocketServer(
	manager,
	{ flush: () => [] } as unknown as ScrollbackStore,
	join(dir, "daemon.sock")
);
// Use real sockets and PTYs with the old wire contract: raw replay, no
// capabilities. This proxy cannot accidentally exercise modern snapshots.
const connections = new Set<Socket>();
const proxy = createServer((front) => {
	const back = connect(join(dir, "daemon.sock"));
	connections.add(front);
	front.on("close", () => {
		connections.delete(front);
		back.destroy();
	});
	back.on("close", () => front.destroy());
	front.on("error", () => {});
	back.on("error", () => {});
	front.pipe(back);
	let buffer = "";
	back.setEncoding("utf8");
	back.on("data", (data) => {
		buffer += data;
		for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
			const line = buffer.slice(0, end);
			buffer = buffer.slice(end + 1);
			const frame = JSON.parse(line);
			if (frame.type === "ready") {
				frame.protocolVersion = 2;
				frame.capabilities = undefined;
			}
			front.write(`${JSON.stringify(frame)}\n`);
		}
	});
});
const client = new DaemonClient(
	join(dir, legacy ? "legacy.sock" : "daemon.sock"),
	join(dir, "pid"),
	join(dir, "log")
);
let win: BrowserWindow | undefined;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>) {
	for (let i = 0; i < 600; i++) {
		if (await check()) return;
		await sleep(10);
	}
	throw Error("Fixture timed out waiting for terminal");
}
async function run() {
	await app.whenReady();
	initializeDatabase();
	server.listen();
	if (legacy) await new Promise<void>((resolve) => proxy.listen(join(dir, "legacy.sock"), resolve));
	await client.connect();
	setupTerminalIPC(client);
	win = new BrowserWindow({
		show: false,
		width: 1100,
		height: 700,
		webPreferences: {
			preload: join(dir, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
		},
	});
	const wc = win.webContents;
	wc.session.webRequest.onBeforeRequest((d, c) => c({ cancel: !d.url.startsWith("file:") }));
	const html = join(dir, "index.html");
	rendererTrust.register(wc.id, pathToFileURL(html).href);
	await win.loadFile(html);
	await until(() => manager.has("lifecycle"));
	client.write("lifecycle", `python3 -u '${join(dir, "tui.py")}'\r`);
	await until(() => manager.getBuffer("lifecycle").includes("READY"));
	const diagnostics = () => wc.executeJavaScript("window.lifecycle.diagnostics()");
	await until(async () => (await diagnostics())?.mouse === "any");
	client.write("lifecycle", "R");
	await until(() => manager.getBuffer("lifecycle").includes("REDRAW_DONE"));
	for (let i = 0; i < 100; i++) {
		await wc.executeJavaScript("window.lifecycle.navigate(false)");
		await wc.executeJavaScript("window.lifecycle.navigate(true)");
		await until(async () => (await diagnostics())?.mouse === "any");
		const state = await diagnostics();
		assert.equal(state.buffer, "alternate");
		assert(state.normalBaseY >= 250);
		assert.equal(state.replayDepth, 0);
		assert.equal(state.transport.connected, true);
		if (i % 10 === 0) {
			await wc.executeJavaScript("window.lifecycle.navigate(true,false)");
			await wc.executeJavaScript("window.lifecycle.navigate(true,true)");
		}
	}
	wc.debugger.attach("1.3");
	const wheel = async () => {
		const pos = await wc.executeJavaScript(
			"(()=>{const r=document.querySelector('.xterm-screen').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()"
		);
		await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			...pos,
			deltaY: -120,
			deltaX: 0,
		});
	};
	await wheel();
	await until(() => readFileSync(join(dir, "input"), "utf8").includes("\x1b[<64;"));
	assert.equal(readFileSync(join(dir, "input"), "utf8").split("\x1b[<64;").length - 1, 1);
	await wc.executeJavaScript("document.querySelector('.xterm-helper-textarea').focus()");
	wc.sendInputEvent({ type: "char", keyCode: "k" });
	await until(() => manager.getBuffer("lifecycle").includes("KEY_ACK"));
	if (legacy) for (const socket of connections) socket.destroy();
	else client.disconnect();
	await until(async () => !(await diagnostics())?.transport.connected);
	wc.sendInputEvent({ type: "char", keyCode: "q" });
	await until(() =>
		wc.executeJavaScript("document.body.textContent.includes('Input could not be delivered')")
	);
	assert(!readFileSync(join(dir, "input"), "utf8").includes("q"));
	if (!legacy) await client.connect();
	await until(async () => {
		const state = await diagnostics();
		return (
			state?.transport.connected &&
			(legacy ? state.transport.view?.recovery === "legacy-replay" : state.mouse === "any")
		);
	});
	if (legacy) {
		assert(
			await wc.executeJavaScript("document.body.textContent.includes('may be missing history')")
		);
		// Explicit application resume/reinitialization, never guessed modes in
		// the renderer. A real Codex session needs the user's resume action.
		client.write("lifecycle", "S");
		await until(async () => (await diagnostics())?.mouse === "any");
	}
	await wheel();
	await until(() => readFileSync(join(dir, "input"), "utf8").split("\x1b[<64;").length - 1 === 2);
	client.write("lifecycle", "B");
	await until(() => manager.getBuffer("lifecycle").includes("BINARY_READY"));
	await sleep(50);
	const beforeBinary = readFileSync(join(dir, "input")).length;
	const edge = await wc.executeJavaScript(
		"(()=>{const r=document.querySelector('.xterm-screen').getBoundingClientRect();return {x:r.right-2,y:r.top+r.height/2}})()"
	);
	await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		...edge,
		deltaY: -120,
		deltaX: 0,
	});
	if (legacy) {
		await until(() =>
			wc.executeJavaScript("document.body.textContent.includes('cannot receive mouse input')")
		);
		assert.equal(readFileSync(join(dir, "input")).length, beforeBinary);
	} else {
		await until(() => readFileSync(join(dir, "input")).length >= beforeBinary + 6);
		const report = readFileSync(join(dir, "input")).subarray(beforeBinary);
		assert.equal(report.length, 6);
		assert.equal(report.subarray(0, 3).toString(), "\x1b[M");
		assert(report[4] !== undefined && report[4] > 127);
	}
	client.write("lifecycle", "S");
	await until(async () => (await diagnostics())?.mouse === "any");
	const soakMs = Number(process.env["SS_SOAK_MS"] || 0);
	const end = Date.now() + soakMs;
	let rounds = 0;
	const memory: number[] = [];
	while (Date.now() < end) {
		client.write("lifecycle", "R");
		await sleep(1000);
		await wc.executeJavaScript("window.lifecycle.navigate(false)");
		await wc.executeJavaScript("window.lifecycle.navigate(true)");
		await until(async () => (await diagnostics())?.mouse === "any");
		assert.equal((await diagnostics()).replayDepth, 0);
		rounds++;
		if (rounds % 30 === 0) {
			memory.push(process.memoryUsage().rss);
			const progress = process.env["SS_SOAK_PROGRESS"];
			if (progress)
				writeFileSync(
					progress,
					JSON.stringify({
						legacy,
						rounds,
						remainingMs: Math.max(0, end - Date.now()),
						rss: process.memoryUsage().rss,
						diagnostics: await diagnostics(),
					})
				);
		}
		await sleep(1000);
	}
	writeFileSync(
		join(dir, "result.json"),
		JSON.stringify({
			legacy,
			cycles: 100,
			reconnect: true,
			wheelReports: 2,
			typing: true,
			soakRounds: rounds,
			memory,
		})
	);
}
run().then(
	() => finish(0),
	(error) => {
		console.error(error);
		finish(1);
	}
);
function finish(code: number) {
	win?.destroy();
	client.disconnect();
	for (const socket of connections) socket.destroy();
	proxy.close();
	server.close();
	manager.disposeAll();
	app.exit(code);
}
