import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../src/main/terminal/daemon-client";
import { DAEMON_PROTOCOL_VERSION } from "../src/shared/daemon-protocol";
import { TERMINAL_SNAPSHOT_CAPABILITY } from "../src/shared/terminal-replay";

for (const id of ["review-path:owned-run:1", "ordinary-shell"]) {
	test(`attach-not-found socket race preserves ${id} recovery policy`, async () => {
		const dir = await mkdtemp(join(tmpdir(), "ss-owned-attach-"));
		const path = join(dir, "fixture.sock");
		const frames: Array<{ type: string; id?: string; cwd?: string }> = [];
		const peers = new Set<Socket>();
		const server = createServer((socket) => {
			peers.add(socket);
			socket.on("close", () => peers.delete(socket));
			const send = (value: unknown) => socket.write(`${JSON.stringify(value)}\n`);
			send({
				type: "ready",
				protocolVersion: DAEMON_PROTOCOL_VERSION,
				capabilities: [TERMINAL_SNAPSHOT_CAPABILITY],
			});
			let pending = "";
			socket.on("data", (data) => {
				pending += data.toString();
				while (pending.includes("\n")) {
					const end = pending.indexOf("\n");
					const message = JSON.parse(pending.slice(0, end));
					pending = pending.slice(end + 1);
					frames.push(message);
					if (message.type === "list")
						send({ type: "sessions", sessions: [{ id, cwd: dir, pid: 123 }] });
					// Inventory said live, but the PTY died before attach was handled.
					if (message.type === "attach")
						send({ type: "error", id: message.id, message: "session not found" });
				}
			});
		});
		const client = new DaemonClient(path, join(dir, "pid"), join(dir, "log"));
		const exits: number[] = [];
		const output: string[] = [];
		try {
			await new Promise<void>((resolve) => server.listen(path, resolve));
			await client.connect();
			expect((await client.listSessionsStrict()).some((session) => session.id === id)).toBe(true);
			await client.attach(
				id,
				(data) => output.push(data),
				(code) => exits.push(code),
				dir
			);
			// Two FIFO barriers include any fallback frame sent on receipt of the error.
			await client.listSessionsStrict();
			await client.listSessionsStrict();
			const creates = frames.filter((frame) => frame.type === "create");
			if (id.startsWith("review-path:")) {
				expect(creates).toEqual([]);
				expect(exits).toEqual([-1]);
				expect(output.join("")).toContain("Reading-path terminal is no longer available");
				expect(client.getCallbackIds()).not.toContain(id);
			} else {
				expect(creates).toEqual([{ type: "create", id, cwd: dir }]);
				expect(exits).toEqual([]);
			}
			expect(frames.filter((frame) => frame.type === "write")).toEqual([]);
		} finally {
			client.disconnect();
			for (const socket of peers) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await rm(dir, { recursive: true, force: true });
		}
	});
}
