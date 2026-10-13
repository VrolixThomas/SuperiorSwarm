import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DaemonClient as Client } from "../src/main/terminal/daemon-client";
import type { TerminalProcessIdentity } from "../src/shared/terminal-files";

const legacyTest = test.skipIf(process.platform !== "darwin");

let root: string;
let DaemonClient: typeof Client;
let client: Client;
let server: Server;
let nextSocket = 0;
const sockets = new Set<Socket>();
const messages: Array<{ type: string; id?: string; data?: string }> = [];
const text = " '/tmp/a file.pdf' ";
const payload = `\x1b[200~${text}\x1b[201~`;
const identity: TerminalProcessIdentity = {
	pid: 456,
	startedAt: "123:456",
	name: "codex",
	executable: "/fixture/bin/codex",
};

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "terminal-file-legacy-"));
	// Load the production client with its helper beside the bundle, as packaged.
	const build = await Bun.build({
		entrypoints: [resolve(import.meta.dir, "../src/main/terminal/daemon-client.ts")],
		outdir: root,
		target: "node",
		format: "cjs",
		naming: "daemon-client.cjs",
		define: { __dirname: JSON.stringify(root) },
	});
	if (!build.success) throw new Error(build.logs.join("\n"));
	({ DaemonClient } = await import(join(root, "daemon-client.cjs")));
});
afterEach(() => {
	client?.disconnect();
	for (const socket of sockets) socket.destroy();
	sockets.clear();
	server?.close();
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function setup(
	options: {
		nativePid?: number;
		onWrite?: (data: string) => void;
		protocolVersion?: number;
		brokenFileInspector?: boolean;
	} = {}
) {
	messages.length = 0;
	if (options.nativePid) {
		execFileSync("cc", [
			"-std=c11",
			"-Wall",
			"-Wextra",
			"-Werror",
			"-O2",
			resolve(import.meta.dir, "../src/daemon/terminal-process-info.c"),
			"-o",
			join(root, "terminal-process-info"),
		]);
	} else {
		writeFileSync(join(root, "identity.json"), JSON.stringify(identity));
		writeFileSync(
			join(root, "terminal-process-info"),
			`#!/bin/sh\n/bin/cat '${root}/identity.json'\n`
		);
		chmodSync(join(root, "terminal-process-info"), 0o755);
	}
	const path = join(root, `${nextSocket++}.sock`);
	server = createServer((socket) => {
		sockets.add(socket);
		// Match the observed live daemon: v2, no capability list or file frames.
		socket.write(
			`${JSON.stringify({
				type: "ready",
				protocolVersion: options.protocolVersion ?? 2,
				capabilities: options.brokenFileInspector ? ["file-input-v1"] : undefined,
			})}\n`
		);
		let buffer = "";
		socket.on("data", (data) => {
			buffer += data.toString();
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) break;
				const message = JSON.parse(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				messages.push(message);
				if (message.type === "file-target")
					socket.write(
						`${JSON.stringify({
							type: "file-result",
							requestId: message.requestId,
							target: { generation: "old-inspector", foreground: "codex", supported: false },
						})}\n`
					);
				if (message.type === "list")
					socket.write(
						`${JSON.stringify({
							type: "sessions",
							sessions: [{ id: "term", pid: options.nativePid ?? 123, cwd: root }],
						})}\n`
					);
				if (message.type === "write") options.onWrite?.(message.data);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(path, resolve));
	client = new DaemonClient(path, join(root, "pid"), join(root, "log"));
	await client.connect();
	await client.attach(
		"term",
		() => {},
		() => {}
	);
}
const writes = () => messages.filter((message) => message.type === "write");
async function flush() {
	await client.listSessionsStrict(); // same socket: the reply follows all preceding input
}
async function generation() {
	const target = await client.fileTarget("term");
	expect(target?.supported).toBe(true);
	if (!target) throw new Error("Missing target");
	return target.generation;
}

legacyTest(
	"the observed v2 daemon accepts one insertion without Enter, file frames, retries, or a restart",
	async () => {
		await setup();
		const token = await generation();
		expect(await client.insertFiles("term", token, text, payload)).toBe("unconfirmed");
		expect(await client.insertFiles("term", token, text, payload)).toBe("rejected");
		await flush();
		expect(writes()).toEqual([{ type: "write", id: "term", data: payload }]);
		expect(
			messages.some((message) => ["file-target", "file-input", "dispose"].includes(message.type))
		).toBe(false);
	}
);

legacyTest(
	"capability detection also handles a current protocol without file-input support",
	async () => {
		await setup({ protocolVersion: 3 });
		expect(client.needsFileInputUpdate).toBe(true);
		const token = await generation();
		expect(await client.insertFiles("term", token, text, text)).toBe("unconfirmed");
		await flush();
		expect(writes()).toHaveLength(1);
	}
);

legacyTest(
	"legacy insertion refuses submission, terminal controls, malformed paste, and oversized frames",
	async () => {
		await setup();
		for (const [plain, pasted, submit] of [
			[text, payload, true],
			[`${text}\r`, `${text}\r`, false],
			[text, `${payload}\r`, false],
			["a".repeat(32769), "a".repeat(32769), false],
			['"'.repeat(32000), '"'.repeat(32000), false],
		] as const) {
			expect(await client.insertFiles("term", await generation(), plain, pasted, submit)).toBe(
				"rejected"
			);
		}
		await flush();
		expect(writes()).toEqual([]);
	}
);

legacyTest(
	"a surviving capable daemon with a broken inspector uses a locally verified lease",
	async () => {
		await setup({ protocolVersion: 3, brokenFileInspector: true });
		expect(client.needsFileInputUpdate).toBe(false);
		// An advertised local name is insufficient; the new app must inspect the OS process.
		writeFileSync(
			join(root, "identity.json"),
			JSON.stringify({ ...identity, executable: "/usr/bin/ssh" })
		);
		expect((await client.fileTarget("term"))?.supported).toBe(false);
		writeFileSync(join(root, "identity.json"), JSON.stringify(identity));
		const changed = await generation();
		writeFileSync(join(root, "identity.json"), JSON.stringify({ ...identity, pid: 999 }));
		expect(await client.insertFiles("term", changed, text, payload)).toBe("rejected");
		writeFileSync(join(root, "identity.json"), JSON.stringify(identity));
		const token = await generation();
		expect(await client.insertFiles("term", token, text, payload)).toBe("unconfirmed");
		await flush();
		expect(writes()).toEqual([{ type: "write", id: "term", data: payload }]);
		expect(messages.some((message) => message.type === "file-input")).toBe(false);
	}
);

legacyTest(
	"legacy inspection rejects SSH, unknown runtimes, missing helpers and changed process identity",
	async () => {
		await setup();
		for (const executable of ["/usr/bin/ssh", "/usr/local/bin/node", "/tmp/unknown"]) {
			writeFileSync(join(root, "identity.json"), JSON.stringify({ ...identity, executable }));
			expect((await client.fileTarget("term"))?.supported).toBe(false);
		}
		for (const change of [{ pid: 999 }, { startedAt: "999:123" }, { executable: "/usr/bin/ssh" }]) {
			writeFileSync(join(root, "identity.json"), JSON.stringify(identity));
			const token = await generation();
			writeFileSync(join(root, "identity.json"), JSON.stringify({ ...identity, ...change }));
			expect(await client.insertFiles("term", token, text, payload)).toBe("rejected");
		}
		rmSync(join(root, "terminal-process-info"));
		expect((await client.fileTarget("term"))?.supported).toBe(false);
		await flush();
		expect(writes()).toEqual([]);
	}
);

legacyTest(
	"ordinary submit, detach, disconnect and backpressure invalidate or reject legacy file input",
	async () => {
		await setup();
		let token = await generation();
		client.write("term", "\r");
		expect(await client.insertFiles("term", token, text, payload)).toBe("rejected");
		token = await generation();
		client.detach("term");
		expect(await client.insertFiles("term", token, text, payload)).toBe("rejected");
		await client.attach(
			"term",
			() => {},
			() => {}
		);
		token = await generation();
		client.setInputPending("term", true);
		expect(await client.insertFiles("term", token, text, payload)).toBe("rejected");
		client.setInputPending("term", false);
		token = await generation();
		const transport = client as unknown as { waitingForDrain: boolean };
		transport.waitingForDrain = true;
		expect(await client.insertFiles("term", token, text, payload)).toBe("rejected");
		transport.waitingForDrain = false;
		await flush();
		expect(writes()).toEqual([{ type: "write", id: "term", data: "\r" }]);
		token = await generation();
		client.disconnect();
		expect(await client.insertFiles("term", token, text, payload)).toBe("rejected");
	}
);

legacyTest(
	"a detached or submitted session cannot gain a lease from a late list response",
	async () => {
		await setup();
		const target = client.fileTarget("term");
		client.write("term", "\r");
		expect(await target).toBeNull();
		const detached = client.fileTarget("term");
		client.detach("term");
		expect(await detached).toBeNull();
	}
);

legacyTest(
	"real native inspection and legacy socket delivery insert exactly once before a separate Enter",
	async () => {
		const executable = join(root, "codex");
		const capture = join(root, "input");
		execFileSync("cc", [
			resolve(import.meta.dir, "fixtures/terminal-file-electron/tui.c"),
			"-o",
			executable,
		]);
		// Run node-pty in Node, matching the daemon runtime rather than Bun's TTY shim.
		const terminal = spawn(
			"node",
			[
				"-e",
				`
const terminal = require(process.argv[1]).spawn(process.argv[2], [], {
 cwd: process.argv[3], cols: 120, rows: 24,
 env: { TERM: "xterm-256color", SS_FIXTURE_CAPTURE: process.argv[4] }
});
process.stdout.write(String(terminal.pid) + "\\n");
terminal.onData(data => process.stdout.write(data));
process.stdin.on("data", data => terminal.write(data.toString()));
process.on("SIGTERM", () => { terminal.kill("SIGKILL"); process.exit(); });
terminal.onExit(() => process.exit());
`,
				require.resolve("node-pty"),
				executable,
				root,
				capture,
			],
			{ stdio: ["pipe", "pipe", "pipe"] }
		);
		let output = "";
		terminal.stdout.on("data", (data) => {
			output += data;
		});

		try {
			for (let i = 0; i < 200 && !output.includes("FIXTURE_READY"); i++)
				await new Promise((resolve) => setTimeout(resolve, 10));
			expect(output).toContain("FIXTURE_READY");
			await setup({
				nativePid: Number(output.split("\n")[0]),
				onWrite: (data) => terminal.stdin.write(data),
			});
			for (let i = 0; i < 200 && !existsSync(capture); i++)
				await new Promise((resolve) => setTimeout(resolve, 10));
			expect(existsSync(capture)).toBe(true);
			const token = await generation();
			expect(readFileSync(capture, "utf8")).toBe("");
			expect(await client.insertFiles("term", token, text, payload)).toBe("unconfirmed");
			await flush();
			for (let i = 0; i < 100 && readFileSync(capture, "utf8") !== payload; i++)
				await new Promise((resolve) => setTimeout(resolve, 10));
			expect(readFileSync(capture, "utf8")).toBe(payload);
			expect(writes()).toHaveLength(1);
			client.write("term", "\r");
			await flush();
			for (let i = 0; i < 100 && readFileSync(capture, "utf8") !== `${payload}\r`; i++)
				await new Promise((resolve) => setTimeout(resolve, 10));
			expect(readFileSync(capture, "utf8")).toBe(`${payload}\r`);
		} finally {
			const exited = new Promise<void>((resolve) => terminal.once("exit", () => resolve()));
			terminal.kill("SIGTERM");
			if (terminal.exitCode === null) await exited;
		}
	}
);
