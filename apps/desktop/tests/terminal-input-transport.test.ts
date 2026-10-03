import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PtyManager } from "../src/daemon/pty-manager";
import { SocketServer } from "../src/daemon/socket-server";
import { DaemonClient } from "../src/main/terminal/daemon-client";
import { registerTerminalInputIPC } from "../src/main/terminal/input-ipc";
import { createTerminalInputAPI } from "../src/preload/terminal-input";
import { installTerminalInput } from "../src/renderer/components/terminal-input";

test("renderer/preload/main/socket/daemon/PtyManager delivers exact bytes to the same PTY sink", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ss-input-"));
	const socketPath = join(dir, "test.sock");
	const sink: Array<string | Buffer> = [];
	const manager = new PtyManager();
	// A writable PTY seam exercises the real PtyManager.write without spawning
	// an interactive shell or depending on Bun's native PTY event delivery.
	(manager as unknown as { terminals: Map<string, unknown> }).terminals.set("target", {
		pty: { write: (data: string | Buffer) => sink.push(data) },
		cwd: dir,
		buffer: "",
		dirty: false,
		dataListeners: new Map(),
		exitListeners: new Map(),
	});
	const server = new SocketServer(manager, { flush: () => [] } as never, socketPath);
	const client = new DaemonClient(socketPath, join(dir, "pid"), join(dir, "log"));
	let cleanup = () => {};
	try {
		server.listen();
		await client.connect();
		const handlers = new Map<
			string,
			(e: unknown, id: unknown, data: unknown) => Promise<boolean>
		>();
		registerTerminalInputIPC({ handle: (channel, cb) => handlers.set(channel, cb) }, client);
		const pending: Promise<boolean>[] = [];
		const api = createTerminalInputAPI((channel, id, data) => {
			const handler = handlers.get(channel);
			if (!handler) throw Error(channel);
			const result = handler(null, id, data);
			pending.push(result);
			return result;
		});
		let onText = (_data: string) => {};
		let onBinary = (_data: string) => {};
		cleanup = installTerminalInput(
			{
				onData: (cb) => {
					onText = cb;
					return { dispose: () => {} };
				},
				onBinary: (cb) => {
					onBinary = cb;
					return { dispose: () => {} };
				},
			},
			() => false,
			(data) => {
				void api.write("target", data);
			},
			(data) => {
				void api.writeBinary("target", data);
			}
		);
		const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
		onText("猫🐟");
		onBinary(bytes.toString("latin1"));
		onText("after");
		expect(await Promise.all(pending)).toEqual([true, true, true]);
		// list is a socket FIFO barrier after the input frames.
		await client.listSessionsStrict();
		expect(sink).toEqual(["猫🐟", bytes, "after"]);
		expect(Buffer.isBuffer(sink[1])).toBe(true);
	} finally {
		cleanup();
		client.disconnect();
		server.close();
		await rm(dir, { recursive: true, force: true });
	}
});
