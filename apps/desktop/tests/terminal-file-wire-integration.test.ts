import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileInputSessions } from "../src/daemon/file-input-sessions";
import type { PtyManager } from "../src/daemon/pty-manager";
import type { ScrollbackStore } from "../src/daemon/scrollback-store";
import { SocketServer } from "../src/daemon/socket-server";
import { DaemonClient } from "../src/main/terminal/daemon-client";

test("real client/server protocol sends one combined file paste and requested Enter for all agent transports", async () => {
	const root = mkdtempSync(join(tmpdir(), "terminal-file-protocol-"));
	const socket = join(root, "daemon.sock");
	const writes: Array<{ id: string; data: string }> = [];
	const fileInputs = new FileInputSessions();
	let foreground = "claude";
	const manager = {
		fileInputs,
		create: (id: string, _cwd: string, _data: unknown, _exit: unknown, client: string) =>
			fileInputs.create(
				id,
				client,
				"/bin/zsh",
				() => foreground,
				(data) => writes.push({ id, data })
			),
		list: () => [],
		getDirtyBuffers: () => [],
		markBuffersFlushed: () => {},
		detachClient: () => fileInputs.clear(),
		write: () => {
			throw new Error("File sending must not use ordinary writes");
		},
	};
	const server = new SocketServer(
		manager as unknown as PtyManager,
		{ flush: () => [] } as unknown as ScrollbackStore,
		socket
	);
	const client = new DaemonClient(socket, join(root, "pid"), join(root, "log"));
	server.listen();
	try {
		await client.connect();
		expect(client.supportsFileSubmit).toBe(true);
		for (const provider of ["claude", "codex", "gemini", "opencode", "node", "bun"]) {
			foreground = provider;
			await client.create(
				provider,
				root,
				() => {},
				() => {}
			);
			const target = await client.fileTarget(provider, provider === "node" || provider === "bun");
			expect(target?.supported).toBe(true);
			const text = " '/fixture/first.pdf' '/fixture/second.mov' ";
			const payload = `\x1b[200~${text}\x1b[201~`;
			expect(await client.insertFiles(provider, target!.generation, text, payload, true)).toBe(
				"admitted"
			);
			expect(writes.at(-1)).toEqual({ id: provider, data: `${payload}\r` });
		}
		expect(writes).toHaveLength(6);
	} finally {
		client.disconnect();
		server.close();
		rmSync(root, { recursive: true, force: true });
	}
});
