import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../../src/main/terminal/daemon-client";

const TEST_SOCKET = join(tmpdir(), `branchflux-client-test-${process.pid}.sock`);
const TEST_PID = join(tmpdir(), `branchflux-client-test-${process.pid}.pid`);
const TEST_LOG = join(tmpdir(), `branchflux-client-test-${process.pid}.log`);

function startMockDaemon(
	onMessage?: (msg: unknown) => void,
	sessions?: Array<{ id: string; cwd: string; pid: number }>
): Promise<{ server: Server; lastSocket: () => Socket | null }> {
	const sessionList = sessions ?? [{ id: "term-1", cwd: "/tmp", pid: 99 }];
	return new Promise((resolve) => {
		let lastSock: Socket | null = null;
		const server = createServer((socket) => {
			lastSock = socket;
			// Send ready
			socket.write(`${JSON.stringify({ type: "ready" })}\n`);
			// Handle list request → respond with sessions
			let buf = "";
			socket.on("data", (chunk) => {
				buf += chunk.toString();
				let nl: number;
				while ((nl = buf.indexOf("\n")) !== -1) {
					const line = buf.slice(0, nl).trim();
					buf = buf.slice(nl + 1);
					if (!line) continue;
					try {
						const msg = JSON.parse(line);
						onMessage?.(msg);
						if (msg.type === "list") {
							socket.write(`${JSON.stringify({ type: "sessions", sessions: sessionList })}\n`);
						}
					} catch {}
				}
			});
		});
		server.listen(TEST_SOCKET, () => resolve({ server, lastSocket: () => lastSock }));
	});
}

describe("DaemonClient", () => {
	let daemon: { server: Server; lastSocket: () => Socket | null };
	let client: DaemonClient;

	beforeEach(async () => {
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
		if (existsSync(TEST_PID)) rmSync(TEST_PID);
		if (existsSync(TEST_LOG)) rmSync(TEST_LOG);
		daemon = await startMockDaemon();
		client = new DaemonClient(TEST_SOCKET, TEST_PID, TEST_LOG);
		await client.connect();
	});

	afterEach(() => {
		client.disconnect();
		daemon.server.close();
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
		if (existsSync(TEST_PID)) rmSync(TEST_PID);
		if (existsSync(TEST_LOG)) rmSync(TEST_LOG);
	});

	test("hasLiveSession returns true for daemon-reported sessions", () => {
		expect(client.hasLiveSession("term-1")).toBe(true);
	});

	test("hasLiveSession returns false for unknown sessions", () => {
		expect(client.hasLiveSession("term-99")).toBe(false);
	});

	test("setQuitting prevents dispose from sending a message", async () => {
		const sent: string[] = [];
		const sock = daemon.lastSocket();
		if (sock) {
			sock.on("data", (chunk) => sent.push(chunk.toString()));
		}

		client.setQuitting();
		client.dispose("term-1");

		await new Promise<void>((r) => setTimeout(r, 80));
		expect(sent.some((s) => s.includes('"dispose"'))).toBe(false);
	});

	test("create sends a create message to the daemon", async () => {
		const sent: string[] = [];
		const sock = daemon.lastSocket();
		if (sock) {
			sock.on("data", (chunk) => sent.push(chunk.toString()));
		}

		await client.create(
			"new-term",
			"/home/user",
			() => {},
			() => {}
		);

		await new Promise<void>((r) => setTimeout(r, 80));
		const combined = sent.join("");
		expect(combined).toContain('"create"');
		expect(combined).toContain('"new-term"');
	});

	test("reconnects after daemon connection is lost", async () => {
		// Destroy the current daemon server to simulate crash
		const sock = daemon.lastSocket();
		sock?.destroy();
		daemon.server.close();

		// Wait for client to detect close
		await new Promise<void>((r) => setTimeout(r, 200));

		// Start new mock daemon on same socket
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
		daemon = await startMockDaemon();

		// Wait for reconnection (first attempt at 1s backoff)
		await new Promise<void>((r) => setTimeout(r, 2_000));

		// After reconnect, client should have refreshed session list
		expect(client.hasLiveSession("term-1")).toBe(true);
	}, 10_000);

	test("re-attaches sessions with callbacks after reconnect", async () => {
		// Attach to term-1 (which the daemon reports as alive)
		let exitCode: number | null = null;
		await client.attach(
			"term-1",
			() => {},
			(code) => {
				exitCode = code;
			}
		);

		// Destroy the daemon to simulate crash
		const sock = daemon.lastSocket();
		sock?.destroy();
		daemon.server.close();

		await new Promise<void>((r) => setTimeout(r, 200));

		// Restart daemon — track messages the new daemon receives
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
		const received: unknown[] = [];
		daemon = await startMockDaemon((msg) => {
			received.push(msg);
		});

		// Wait for reconnection
		await new Promise<void>((r) => setTimeout(r, 2_000));

		// The client should have re-sent an attach for term-1
		const attachMsgs = received.filter((m) => {
			const msg = m as Record<string, unknown>;
			return msg["type"] === "attach" && msg["id"] === "term-1";
		});
		expect(attachMsgs.length).toBeGreaterThanOrEqual(1);
		// onExit should NOT have been called since the session is still alive
		expect(exitCode).toBeNull();
	}, 10_000);

	test("calls onExit(-1) for sessions that died during disconnect", async () => {
		// Attach to term-1
		let exitCode: number | null = null;
		await client.attach(
			"term-1",
			() => {},
			(code) => {
				exitCode = code;
			}
		);

		// Destroy the daemon
		const sock = daemon.lastSocket();
		sock?.destroy();
		daemon.server.close();

		await new Promise<void>((r) => setTimeout(r, 200));

		// Restart daemon with NO sessions — simulates PTY died while disconnected
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
		daemon = await startMockDaemon(undefined, []);

		// Wait for reconnection
		await new Promise<void>((r) => setTimeout(r, 2_000));

		// The client should have called onExit(-1) for the dead session
		expect(exitCode).toBe(-1);
		// And it should no longer be in liveSessions
		expect(client.hasLiveSession("term-1")).toBe(false);
	}, 10_000);
});
