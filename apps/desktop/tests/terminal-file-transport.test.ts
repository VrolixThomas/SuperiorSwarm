import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../src/main/terminal/daemon-client";
let fixture: string;
let server: Server;
let client: DaemonClient;
let socket: Socket | undefined;
afterEach(() => {
	client?.disconnect();
	socket?.destroy();
	server?.close();
	if (fixture) rmSync(fixture, { recursive: true, force: true });
});
async function setup(reply: boolean, submitCapable = false) {
	fixture = mkdtempSync(join(tmpdir(), "terminal-file-wire-"));
	const path = join(fixture, "daemon.sock");
	const messages: Record<string, unknown>[] = [];
	server = createServer((s) => {
		socket = s;
		s.write(
			`${JSON.stringify({ type: "ready", protocolVersion: 2, capabilities: submitCapable ? ["file-input-v1", "file-submit-v1"] : ["file-input-v1"] })}\n`
		);
		let buffer = "";
		s.on("data", (chunk) => {
			buffer += chunk.toString();
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) break;
				const msg = JSON.parse(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				messages.push(msg);
				if (msg.type === "list")
					s.write(
						`${JSON.stringify({ type: "sessions", sessions: [{ id: "term", pid: 123, cwd: fixture }] })}\n`
					);
				if (msg.type === "file-target")
					s.write(
						`${JSON.stringify({ type: "file-result", requestId: msg.requestId, target: { generation: "g1", foreground: "zsh", supported: true } })}\n`
					);
				if (msg.type === "file-input" && reply)
					s.write(
						`${JSON.stringify({ type: "file-result", requestId: msg.requestId, delivery: "admitted" })}\n`
					);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(path, resolve));
	client = new DaemonClient(path, join(fixture, "pid"), join(fixture, "log"));
	await client.connect();
	return messages;
}
test("one maximum-size batch has one acknowledged frame; no ordinary writes or Enter", async () => {
	const messages = await setup(true);
	const target = await client.fileTarget("term");
	expect(target?.generation).toBe("g1");
	const text = ` '${"a".repeat(32760)}' `;
	expect(await client.insertFiles("term", "g1", text, text)).toBe("admitted");
	expect(messages.filter((m) => m["type"] === "write")).toEqual([]);
	expect(messages.filter((m) => m["type"] === "file-input")).toHaveLength(1);
});
test("socket disconnect after handoff is uncertain and never auto-replayed", async () => {
	const messages = await setup(false);
	const delivery = client.insertFiles("term", "g1", " '/tmp/a' ", " '/tmp/a' ");
	await new Promise((resolve) => setTimeout(resolve, 30));
	client.disconnect();
	expect(await delivery).toBe("uncertain");
	expect(messages.filter((m) => m["type"] === "file-input")).toHaveLength(1);
	expect(await client.insertFiles("term", "g1", " '/tmp/a' ", " '/tmp/a' ")).toBe("rejected");
});

test("explicit submit is capability-gated and never downgraded into an insertion on an older daemon", async () => {
	const messages = await setup(true);
	expect(await client.insertFiles("term", "g1", " '/tmp/a' ", " '/tmp/a' ", true)).toBe("rejected");
	expect(messages.filter((m) => m["type"] === "file-input")).toHaveLength(0);
});
test("explicit submit uses one guarded frame with the user's send request", async () => {
	const messages = await setup(true, true);
	expect(await client.insertFiles("term", "g1", " '/tmp/a' ", " '/tmp/a' ", true)).toBe("admitted");
	expect(messages.filter((m) => m["type"] === "file-input")).toMatchObject([
		{ payload: " '/tmp/a' ", submit: true },
	]);
});

test("the main process can report an old terminal service without stopping its sessions", async () => {
	const messages = await setup(true);
	expect(client.needsFileInputUpdate).toBe(true);
	expect(messages.some((message) => message["type"] === "dispose")).toBe(false);
	client.disconnect();
	expect(client.needsFileInputUpdate).toBe(false);
});
