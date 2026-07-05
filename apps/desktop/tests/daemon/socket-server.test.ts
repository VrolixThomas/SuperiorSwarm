import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { type Socket, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SocketServer } from "../../src/daemon/socket-server";
import type { DaemonMessage } from "../../src/shared/daemon-protocol";

const TEST_SOCKET = join(tmpdir(), `superiorswarm-test-${process.pid}.sock`);

// Minimal mock PtyManager that satisfies the PtyManager interface
class MockPtyManager {
	created: Array<{ id: string; cwd?: string }> = [];
	attached: string[] = [];
	disposed: string[] = [];

	create(
		id: string,
		cwd: string | undefined,
		_onData: (d: string) => void,
		_onExit: (c: number) => void,
		_clientId: string
	): void {
		this.created.push({ id, cwd });
	}
	attach(
		id: string,
		_onData: (d: string) => void,
		_onExit: (c: number) => void,
		_clientId: string
	): { buffer: string; process: string } | null {
		this.attached.push(id);
		return { buffer: "buffered-content", process: "zsh" };
	}
	dispose(id: string): void {
		this.disposed.push(id);
	}
	written: Array<{ id: string; data: string }> = [];
	write(id: string, data: string): void {
		this.written.push({ id, data });
	}
	resize(_id: string, _c: number, _r: number): void {}
	detachedClients: string[] = [];
	detachedSessions: Array<{ clientId: string; id: string }> = [];
	detachClient(clientId: string): void {
		this.detachedClients.push(clientId);
	}
	detachSession(clientId: string, id: string): boolean {
		this.detachedSessions.push({ clientId, id });
		return true;
	}
	list(): Array<{ id: string; cwd: string; pid: number }> {
		return [{ id: "t1", cwd: "/tmp", pid: 123 }];
	}
	getBuffer(_id: string): string {
		return "";
	}
	getAllBuffers(): Array<{ id: string; cwd: string; buffer: string }> {
		return [];
	}
}

class MockScrollbackStore {
	flush(_sessions: Array<{ id: string; buffer: string }>): void {}
	close(): void {}
}

function collectMessages(socket: Socket, timeoutMs = 300): Promise<DaemonMessage[]> {
	return new Promise((resolve) => {
		const msgs: DaemonMessage[] = [];
		let buf = "";
		const timer = setTimeout(() => resolve(msgs), timeoutMs);
		socket.on("data", (chunk) => {
			buf += chunk.toString("utf-8");
			for (;;) {
				const newline = buf.indexOf("\n");
				if (newline === -1) break;
				const line = buf.slice(0, newline).trim();
				buf = buf.slice(newline + 1);
				if (line) {
					try {
						msgs.push(JSON.parse(line) as DaemonMessage);
					} catch {}
				}
			}
			clearTimeout(timer);
			setTimeout(() => resolve(msgs), 50);
		});
	});
}

function sendMsg(socket: Socket, msg: object): void {
	socket.write(`${JSON.stringify(msg)}\n`);
}

describe("SocketServer", () => {
	let server: SocketServer;
	let mockPty: MockPtyManager;
	let mockStore: MockScrollbackStore;

	beforeEach(() => {
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
		mockPty = new MockPtyManager();
		mockStore = new MockScrollbackStore();
		server = new SocketServer(mockPty as never, mockStore as never, TEST_SOCKET);
		server.listen();
	});

	afterEach(() => {
		server.close();
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
	});

	test("sends ready on connect", async () => {
		const socket = connect(TEST_SOCKET);
		const msgs = await collectMessages(socket);
		socket.destroy();
		expect(msgs.some((m) => m.type === "ready")).toBe(true);
	});

	test("list returns sessions from PtyManager", async () => {
		const socket = connect(TEST_SOCKET);
		await collectMessages(socket); // consume ready
		sendMsg(socket, { type: "list" });
		const msgs = await collectMessages(socket);
		socket.destroy();
		const sessions = msgs.find((m) => m.type === "sessions");
		expect(sessions?.type).toBe("sessions");
		if (sessions?.type === "sessions") {
			expect(sessions.sessions[0]?.id).toBe("t1");
		}
	});

	test("attach streams buffered content as base64 data message", async () => {
		const socket = connect(TEST_SOCKET);
		await collectMessages(socket);
		sendMsg(socket, { type: "attach", id: "term-1" });
		const msgs = await collectMessages(socket);
		socket.destroy();
		expect(mockPty.attached).toContain("term-1");
		const dataMsg = msgs.find((m) => m.type === "data");
		expect(dataMsg?.type).toBe("data");
		if (dataMsg?.type === "data") {
			expect(Buffer.from(dataMsg.data, "base64").toString("utf-8")).toBe("buffered-content");
		}
	});

	test("dispose calls ptyManager.dispose", async () => {
		const socket = connect(TEST_SOCKET);
		await collectMessages(socket);
		sendMsg(socket, { type: "dispose", id: "term-1" });
		await collectMessages(socket);
		socket.destroy();
		expect(mockPty.disposed).toContain("term-1");
	});

	test("detach with id detaches only that session, not the whole client", async () => {
		const socket = connect(TEST_SOCKET);
		await collectMessages(socket); // consume ready
		sendMsg(socket, { type: "detach", id: "term-1" });
		await collectMessages(socket);

		expect(mockPty.detachedSessions).toEqual([{ clientId: "client-1", id: "term-1" }]);
		// A per-session detach must never strip the client from all terminals —
		// that froze every other open terminal for the shared main-process client.
		expect(mockPty.detachedClients).toEqual([]);
		socket.destroy();
	});

	test("detach-all detaches the client from all sessions", async () => {
		const socket = connect(TEST_SOCKET);
		await collectMessages(socket); // consume ready
		sendMsg(socket, { type: "detach-all" });
		await collectMessages(socket);

		expect(mockPty.detachedClients).toEqual(["client-1"]);
		expect(mockPty.detachedSessions).toEqual([]);
		socket.destroy();
	});

	test("drops oversized inbound line, warns, and continues parsing subsequent frames", async () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.map((a) => String(a)).join(" "));
		};

		const socket = connect(TEST_SOCKET);
		await collectMessages(socket);

		try {
			socket.write(`${"x".repeat(250_000)}\n`);
			sendMsg(socket, { type: "list" });

			const msgs = await collectMessages(socket, 600);
			const sessions = msgs.find((m) => m.type === "sessions");
			expect(sessions?.type).toBe("sessions");
			expect(warnings.some((w) => w.includes("oversized inbound frame"))).toBe(true);
		} finally {
			console.warn = originalWarn;
			socket.destroy();
		}
	});

	test("accepts multibyte frames a char-bounded v1 client could legitimately send", async () => {
		const socket = connect(TEST_SOCKET);
		await collectMessages(socket);

		try {
			// v1 clients bounded outbound frames in UTF-16 chars, not bytes: 25k
			// "€" is well under 64k chars but ~75KB of UTF-8. Dropping it would
			// silently swallow pastes from a v1 client talking to this daemon.
			const data = "€".repeat(25_000);
			sendMsg(socket, { type: "write", id: "t1", data });
			await collectMessages(socket, 400);

			expect(mockPty.written).toEqual([{ id: "t1", data }]);
		} finally {
			socket.destroy();
		}
	});

	test("drops inbound frames beyond the v1 char-based envelope in bytes", async () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.map((a) => String(a)).join(" "));
		};

		const socket = connect(TEST_SOCKET);
		await collectMessages(socket);

		try {
			// 70k "€" = 210KB of UTF-8 — beyond anything either client version can
			// legitimately produce (v1 caps chars at 64k; UTF-8 is ≤3 bytes/char).
			socket.write(`${"€".repeat(70_000)}\n`);
			sendMsg(socket, { type: "list" });

			const msgs = await collectMessages(socket, 600);
			expect(msgs.some((m) => m.type === "sessions")).toBe(true);
			expect(warnings.some((w) => w.includes("oversized inbound frame"))).toBe(true);
		} finally {
			console.warn = originalWarn;
			socket.destroy();
		}
	});

	test("decodes multibyte characters split across inbound socket chunks", async () => {
		const socket = connect(TEST_SOCKET);
		await collectMessages(socket);

		try {
			const data = "héllo🐟wörld";
			const frame = Buffer.from(`${JSON.stringify({ type: "write", id: "t1", data })}\n`, "utf-8");
			// Split inside the 4-byte fish emoji: per-chunk toString() would feed
			// the PTY U+FFFD garbage instead of the pasted character.
			const splitAt = frame.indexOf(Buffer.from("🐟")) + 2;
			socket.write(frame.subarray(0, splitAt));
			await new Promise<void>((r) => setTimeout(r, 50));
			socket.write(frame.subarray(splitAt));
			await collectMessages(socket, 300);

			expect(mockPty.written).toEqual([{ id: "t1", data }]);
		} finally {
			socket.destroy();
		}
	});

	test("attach sends buffered content marked as replay with fg process", async () => {
		const socket = connect(TEST_SOCKET);
		await collectMessages(socket); // consume ready
		sendMsg(socket, { type: "attach", id: "replay-test" });
		const msgs = await collectMessages(socket);
		socket.destroy();

		const dataMsg = msgs.find((m) => m.type === "data" && m.id === "replay-test");
		expect(dataMsg).toBeDefined();
		if (dataMsg?.type !== "data") throw new Error("unreachable");
		expect(Buffer.from(dataMsg.data, "base64").toString("utf-8")).toBe("buffered-content");
		expect(dataMsg.replay).toBe(true);
		expect(dataMsg.fg).toBe("zsh");
	});

	test("parses complete frames before bounding oversized partial frame", async () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.map((a) => String(a)).join(" "));
		};

		const socket = connect(TEST_SOCKET);
		await collectMessages(socket);

		try {
			socket.write(`${JSON.stringify({ type: "list" })}\n${"x".repeat(250_000)}`);
			socket.write(`\n${JSON.stringify({ type: "list" })}\n`);

			const msgs = await collectMessages(socket, 700);
			const sessionMsgs = msgs.filter((m) => m.type === "sessions");
			expect(sessionMsgs.length).toBe(2);
			expect(warnings.some((w) => w.includes("oversized inbound frame"))).toBe(true);
		} finally {
			console.warn = originalWarn;
			socket.destroy();
		}
	});
});
