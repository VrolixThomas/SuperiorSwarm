import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../../src/main/terminal/daemon-client";

const TEST_SOCKET = join(tmpdir(), `superiorswarm-client-test-${process.pid}.sock`);
const TEST_PID = join(tmpdir(), `superiorswarm-client-test-${process.pid}.pid`);
const TEST_LOG = join(tmpdir(), `superiorswarm-client-test-${process.pid}.log`);

function startMockDaemon(
	onMessage?: (msg: unknown) => void,
	sessions?: Array<{ id: string; cwd: string; pid: number }>,
	socketPath?: string
): Promise<{ server: Server; lastSocket: () => Socket | null }> {
	const sessionList = sessions ?? [{ id: "term-1", cwd: "/tmp", pid: 99 }];
	const listenPath = socketPath ?? TEST_SOCKET;
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
		server.listen(listenPath, () => resolve({ server, lastSocket: () => lastSock }));
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

	test("dispose sends message even after setQuitting", async () => {
		const sent: string[] = [];
		const sock = daemon.lastSocket();
		if (sock) {
			sock.on("data", (chunk) => sent.push(chunk.toString()));
		}

		client.setQuitting();
		client.dispose("term-1");

		await new Promise<void>((r) => setTimeout(r, 80));
		expect(sent.some((s) => s.includes('"dispose"'))).toBe(true);
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

	test("create throws when socket is disconnected", async () => {
		// Disconnect the client so the socket is null
		client.disconnect();

		await expect(
			client.create(
				"new-term",
				"/tmp",
				() => {},
				() => {}
			)
		).rejects.toThrow("not connected");
	});

	test("attach throws when socket is disconnected", async () => {
		client.disconnect();

		await expect(
			client.attach(
				"term-1",
				() => {},
				() => {}
			)
		).rejects.toThrow("not connected");
	});

	test("write silently no-ops when socket is disconnected", () => {
		client.disconnect();

		expect(() => client.write("term-1", "ls\n")).not.toThrow();
	});

	test("resize silently no-ops when socket is disconnected", () => {
		client.disconnect();

		expect(() => client.resize("term-1", 80, 24)).not.toThrow();
	});

	test("isConnected returns true when socket is active", () => {
		expect(client.isConnected).toBe(true);
	});

	test("isConnected returns false after disconnect", () => {
		client.disconnect();
		expect(client.isConnected).toBe(false);
	});

	test("connects successfully when stale socket file exists", async () => {
		// Disconnect the client from beforeEach and stop the mock daemon
		client.disconnect();
		daemon.server.close();

		// Leave the socket file behind (simulating a crashed daemon)
		// TEST_SOCKET still exists on disk from the mock daemon

		// Start a fresh mock daemon that will listen on the same path
		// but only AFTER the stale socket is removed
		const reconnectDaemon = await startMockDaemon();

		// Create a new client and connect — it should handle the stale socket
		const freshClient = new DaemonClient(TEST_SOCKET, TEST_PID, TEST_LOG);
		await freshClient.connect();

		expect(freshClient.isConnected).toBe(true);
		freshClient.disconnect();
		reconnectDaemon.server.close();
	}, 10_000);

	test("startReconnecting connects to a daemon that appears later", async () => {
		// Create a client with no daemon running
		const noSocket = join(tmpdir(), `superiorswarm-reconnect-test-${process.pid}.sock`);
		const noPid = join(tmpdir(), `superiorswarm-reconnect-test-${process.pid}.pid`);
		const noLog = join(tmpdir(), `superiorswarm-reconnect-test-${process.pid}.log`);
		if (existsSync(noSocket)) rmSync(noSocket);

		const freshClient = new DaemonClient(noSocket, noPid, noLog);

		// Initial connect fails — no daemon running
		let connectFailed = false;
		try {
			await freshClient.connect();
		} catch {
			connectFailed = true;
		}
		expect(connectFailed).toBe(true);

		// Kick off reconnection
		freshClient.startReconnecting();

		// Start a mock daemon after a short delay (simulates daemon becoming available)
		await new Promise<void>((r) => setTimeout(r, 500));
		const lateDaemon = await startMockDaemon(undefined, undefined, noSocket);

		// Wait for reconnection (first attempt at 1s backoff)
		await new Promise<void>((r) => setTimeout(r, 2_000));

		expect(freshClient.isConnected).toBe(true);

		freshClient.disconnect();
		lateDaemon.server.close();
		if (existsSync(noSocket)) rmSync(noSocket);
		if (existsSync(noPid)) rmSync(noPid);
		if (existsSync(noLog)) rmSync(noLog);
	}, 10_000);
});
