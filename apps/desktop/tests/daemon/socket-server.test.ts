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
	): string | null {
		this.attached.push(id);
		return "buffered-content";
	}
	dispose(id: string): void {
		this.disposed.push(id);
	}
	write(_id: string, _data: string): void {}
	resize(_id: string, _c: number, _r: number): void {}
	detachClient(_clientId: string): void {}
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

	test("drops oversized inbound line, warns, and continues parsing subsequent frames", async () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.map((a) => String(a)).join(" "));
		};

		const socket = connect(TEST_SOCKET);
		await collectMessages(socket);

		try {
			socket.write(`${"x".repeat(70_000)}\n`);
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

	test("parses complete frames before bounding oversized partial frame", async () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.map((a) => String(a)).join(" "));
		};

		const socket = connect(TEST_SOCKET);
		await collectMessages(socket);

		try {
			socket.write(`${JSON.stringify({ type: "list" })}\n${"x".repeat(70_000)}`);
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
