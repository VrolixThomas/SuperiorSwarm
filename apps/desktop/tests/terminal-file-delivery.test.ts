import { expect, test } from "bun:test";
import { FileInputSessions } from "../src/daemon/file-input-sessions";
import { DaemonClient } from "../src/main/terminal/daemon-client";

test("daemon requires exact PTY and attachment generation and never wakes or retries", () => {
	let foreground = "zsh";
	const writes: string[] = [];
	const sessions = new FileInputSessions();
	sessions.create(
		"term",
		"client",
		"/bin/zsh",
		() => foreground,
		(text) => writes.push(text)
	);
	const target = sessions.target("term", "client");
	expect(target?.supported).toBe(true);
	expect(sessions.insert("term", "client", target!.generation, " '/tmp/a' ", " '/tmp/a' ")).toBe(
		"admitted"
	);
	expect(writes).toEqual([" '/tmp/a' "]);
	sessions.detach("term", "client");
	sessions.attach("term", "client");
	expect(sessions.insert("term", "client", target!.generation, " '/tmp/a' ", " '/tmp/a' ")).toBe(
		"rejected"
	);
	foreground = "ssh";
	expect(sessions.target("term", "client")?.supported).toBe(false);
	expect(sessions.target("term", "other")).toBeNull();
});
test("forbids control bytes, arbitrary wrappers, Enter, stale foreground and replacement sessions", () => {
	let fg = "zsh";
	const writes: string[] = [];
	const sessions = new FileInputSessions();
	sessions.create(
		"term",
		"client",
		"/bin/zsh",
		() => fg,
		(data) => writes.push(data)
	);
	for (const payload of [" '/tmp/a' \r", "\x1b[200~ '/tmp/a' \x1b[201~\r", "arbitrary", "\x16"]) {
		const target = sessions.target("term", "client")!;
		expect(sessions.insert("term", "client", target.generation, " '/tmp/a' ", payload)).toBe(
			"rejected"
		);
	}
	const target = sessions.target("term", "client")!;
	fg = "docker";
	expect(sessions.insert("term", "client", target.generation, " '/tmp/a' ", " '/tmp/a' ")).toBe(
		"rejected"
	);
	fg = "zsh";
	sessions.create(
		"term",
		"client",
		"/bin/zsh",
		() => fg,
		(data) => writes.push(data)
	);
	expect(sessions.insert("term", "client", target.generation, " '/tmp/a' ", " '/tmp/a' ")).toBe(
		"rejected"
	);
	expect(writes).toEqual([]);
});
test("legacy or disconnected daemon declines file input without queuing normal write", async () => {
	const client = new DaemonClient(
		"/unused-generated-test.sock",
		"/unused-generated-test.pid",
		"/unused-generated-test.log"
	);
	expect(await client.fileTarget("term")).toBeNull();
	expect(await client.insertFiles("term", "generation", " '/tmp/a' ", " '/tmp/a' ")).toBe(
		"rejected"
	);
});

test("ordinary submitted commands and per-client lifecycle invalidate pending daemon tokens", () => {
	const writes: string[] = [];
	const sessions = new FileInputSessions();
	sessions.create(
		"term",
		"client",
		"/bin/zsh",
		() => "zsh",
		(data) => writes.push(data)
	);
	const target = sessions.target("term", "client")!;
	sessions.input("term", "echo changed\r");
	expect(sessions.insert("term", "client", target.generation, " '/tmp/a' ", " '/tmp/a' ")).toBe(
		"rejected"
	);
	expect(writes).toEqual([]);
});
