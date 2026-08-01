import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { DaemonClient } from "../../src/main/terminal/daemon-client";
import { DaemonOwnershipMismatchError } from "../../src/main/terminal/daemon-ownership";
import { DAEMON_PROTOCOL_VERSION, type TerminalDataMeta } from "../../src/shared/daemon-protocol";

const TEST_SOCKET = join(tmpdir(), `superiorswarm-client-test-${process.pid}.sock`);
const TEST_PID = join(tmpdir(), `superiorswarm-client-test-${process.pid}.pid`);
const TEST_LOG = join(tmpdir(), `superiorswarm-client-test-${process.pid}.log`);

function startMockDaemon(
	onMessage?: (msg: unknown) => void,
	sessions?: Array<{ id: string; cwd: string; pid: number }>,
	socketPath?: string,
	// null simulates a protocol-1 daemon whose ready message has no version
	protocolVersion: number | null = DAEMON_PROTOCOL_VERSION
): Promise<{ server: Server; lastSocket: () => Socket | null }> {
	const sessionList = sessions ?? [{ id: "term-1", cwd: "/tmp", pid: 99 }];
	const listenPath = socketPath ?? TEST_SOCKET;
	return new Promise((resolve) => {
		let lastSock: Socket | null = null;
		const server = createServer((socket) => {
			lastSock = socket;
			// Send ready (protocolVersion omitted simulates a protocol-1 daemon)
			const ready =
				protocolVersion === null ? { type: "ready" } : { type: "ready", protocolVersion };
			socket.write(`${JSON.stringify(ready)}\n`);
			// Handle list request → respond with sessions
			let buf = "";
			socket.on("data", (chunk) => {
				buf += chunk.toString();
				for (;;) {
					const nl = buf.indexOf("\n");
					if (nl === -1) {
						break;
					}
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

// Patch the client's internal socket so the next write reports backpressure
// (returns false), making subsequent sends queue. Call restore() in finally;
// socket is exposed for emitting "drain".
function forceBackpressureOnce(client: DaemonClient): { socket: Socket; restore: () => void } {
	const internalSocket = (client as unknown as { socket: Socket | null }).socket;
	if (!internalSocket) throw new Error("client has no socket");
	const originalWrite = internalSocket.write.bind(internalSocket);
	let forcedBackpressure = false;
	(internalSocket as unknown as { write: Socket["write"] }).write = ((
		data: Parameters<Socket["write"]>[0],
		encoding?: Parameters<Socket["write"]>[1],
		cb?: Parameters<Socket["write"]>[2]
	) => {
		const result = originalWrite(data, encoding, cb);
		if (!forcedBackpressure) {
			forcedBackpressure = true;
			return false;
		}
		return result;
	}) as Socket["write"];
	return {
		socket: internalSocket,
		restore: () => {
			(internalSocket as unknown as { write: Socket["write"] }).write = originalWrite;
		},
	};
}

// Collect newline-delimited JSON frames arriving on the daemon-side socket
// into the returned (live) array.
function collectFrames(socket: Socket): Array<Record<string, unknown>> {
	const received: Array<Record<string, unknown>> = [];
	let buffer = "";
	const decoder = new StringDecoder("utf8");
	socket.on("data", (chunk) => {
		buffer += decoder.write(chunk);
		for (;;) {
			const newline = buffer.indexOf("\n");
			if (newline === -1) break;
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (!line) continue;
			try {
				received.push(JSON.parse(line) as Record<string, unknown>);
			} catch {}
		}
	});
	return received;
}

// A long-running throwaway process standing in for a stale daemon's pid.
function spawnDummyDaemonProcess(): { pid: number; kill: () => void } {
	const child = spawn("sleep", ["30"], { stdio: "ignore" });
	if (!child.pid) throw new Error("failed to spawn dummy daemon process");
	const pid = child.pid;
	return {
		pid,
		kill: () => {
			try {
				child.kill("SIGKILL");
			} catch {}
		},
	};
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// Standalone mock daemon script for spawnDaemon() to launch: binds the socket
// from the env, writes its pid file, speaks the current protocol, and answers
// "list" with no sessions. Self-terminates so failed tests cannot leak it.
function writeMockDaemonScript(path: string): void {
	writeFileSync(
		path,
		`
const { createServer } = require("node:net");
const { writeFileSync } = require("node:fs");
writeFileSync(process.env.SUPERIORSWARM_PID_PATH, String(process.pid));
const server = createServer((socket) => {
	socket.write(JSON.stringify({ type: "ready", protocolVersion: ${DAEMON_PROTOCOL_VERSION} }) + "\\n");
	let buf = "";
	socket.on("data", (chunk) => {
		buf += chunk.toString("utf-8");
		for (;;) {
			const nl = buf.indexOf("\\n");
			if (nl === -1) break;
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (!line) continue;
			try {
				const msg = JSON.parse(line);
				if (msg.type === "list") {
					socket.write(JSON.stringify({ type: "sessions", sessions: [] }) + "\\n");
				}
			} catch {}
		}
	});
	socket.on("error", () => {});
});
server.listen(process.env.SUPERIORSWARM_SOCKET_PATH);
setTimeout(() => process.exit(0), 15000);
`
	);
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

	test("strict session listing rejects instead of treating disconnect as an empty daemon", async () => {
		client.disconnect();
		await expect(client.listSessions()).resolves.toEqual([]);
		await expect(client.listSessionsStrict()).rejects.toThrow("Terminal daemon is not connected");
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

	test("disconnect does not schedule reconnect attempts", async () => {
		client.disconnect();

		await new Promise<void>((r) => setTimeout(r, 50));

		const internals = client as unknown as {
			reconnecting: boolean;
			reconnectTimer: ReturnType<typeof setTimeout> | null;
		};
		expect(internals.reconnecting).toBe(false);
		expect(internals.reconnectTimer).toBeNull();
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
		const firstListenerStates: boolean[] = [];
		const secondListenerStates: boolean[] = [];
		freshClient.addConnectionStatusListener((connected) => firstListenerStates.push(connected));
		freshClient.addConnectionStatusListener((connected) => secondListenerStates.push(connected));

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
		expect(firstListenerStates).toContain(true);
		expect(secondListenerStates).toContain(true);

		freshClient.disconnect();
		lateDaemon.server.close();
		if (existsSync(noSocket)) rmSync(noSocket);
		if (existsSync(noPid)) rmSync(noPid);
		if (existsSync(noLog)) rmSync(noLog);
	}, 10_000);

	test("queues outbound messages during backpressure and flushes on drain", async () => {
		const daemonSocket = daemon.lastSocket();
		expect(daemonSocket).not.toBeNull();
		if (!daemonSocket) return;
		const received = collectFrames(daemonSocket);

		const { socket: internalSocket, restore } = forceBackpressureOnce(client);

		try {
			client.write("term-1", "alpha");
			client.resize("term-1", 100, 40);

			await new Promise<void>((r) => setTimeout(r, 100));
			const typesBeforeDrain = received.map((m) => m["type"]);
			expect(typesBeforeDrain).toContain("write");
			expect(typesBeforeDrain).not.toContain("resize");

			internalSocket.emit("drain");
			await new Promise<void>((r) => setTimeout(r, 100));

			const typesAfterDrain = received.map((m) => m["type"]);
			expect(typesAfterDrain).toContain("resize");
		} finally {
			restore();
		}
	});

	test("disconnect during backpressure clears drain state so reconnect writes are sent", async () => {
		const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const isolatedSocket = join(tmpdir(), `ss-drain-reset-${nonce}.sock`);
		const isolatedPid = join(tmpdir(), `ss-drain-reset-${nonce}.pid`);
		const isolatedLog = join(tmpdir(), `ss-drain-reset-${nonce}.log`);
		if (existsSync(isolatedSocket)) rmSync(isolatedSocket);
		if (existsSync(isolatedPid)) rmSync(isolatedPid);
		if (existsSync(isolatedLog)) rmSync(isolatedLog);
		const received: Array<Record<string, unknown>> = [];
		const trackedDaemon = await startMockDaemon(
			(msg) => {
				received.push(msg as Record<string, unknown>);
			},
			undefined,
			isolatedSocket
		);
		const trackedClient = new DaemonClient(isolatedSocket, isolatedPid, isolatedLog);
		await trackedClient.connect();

		const { restore } = forceBackpressureOnce(trackedClient);

		try {
			trackedClient.write("term-1", "before-disconnect");
			await new Promise<void>((r) => setTimeout(r, 80));

			trackedClient.disconnect();
			await new Promise<void>((r) => setTimeout(r, 80));
			await trackedClient.connect();

			trackedClient.write("term-1", "after-reconnect");
			await new Promise<void>((r) => setTimeout(r, 120));

			const reconnectWrites = received.filter((msg) => {
				return msg["type"] === "write" && msg["data"] === "after-reconnect";
			});
			expect(reconnectWrites.length).toBe(1);
		} finally {
			restore();
			trackedClient.disconnect();
			trackedDaemon.server.close();
			if (existsSync(isolatedSocket)) rmSync(isolatedSocket);
			if (existsSync(isolatedPid)) rmSync(isolatedPid);
			if (existsSync(isolatedLog)) rmSync(isolatedLog);
		}
	}, 10_000);

	test("preserves control-plane messages when queued bytes limit is exceeded", async () => {
		const daemonSocket = daemon.lastSocket();
		expect(daemonSocket).not.toBeNull();
		if (!daemonSocket) return;
		const received = collectFrames(daemonSocket);

		const originalWarn = console.warn;
		const warnings: string[] = [];
		console.warn = (...args: unknown[]) => {
			warnings.push(args.map((a) => String(a)).join(" "));
		};

		const { socket: internalSocket, restore } = forceBackpressureOnce(client);

		try {
			client.write("term-1", "first");
			for (let i = 0; i < 120; i++) {
				client.write("term-1", "x".repeat(6_000));
			}
			client.dispose("term-1");

			internalSocket.emit("drain");
			await new Promise<void>((r) => setTimeout(r, 120));

			const writes = received.filter((m) => m["type"] === "write");
			const disposes = received.filter((m) => m["type"] === "dispose");
			expect(writes.length).toBeLessThan(121);
			expect(disposes.length).toBe(1);
			expect(warnings.some((w) => w.includes("queue") && w.includes("drop"))).toBe(true);
		} finally {
			restore();
			console.warn = originalWarn;
		}
	});

	test("create rejects with a queue-full error once the byte budget is exhausted", async () => {
		const daemonSocket = daemon.lastSocket();
		expect(daemonSocket).not.toBeNull();
		if (!daemonSocket) return;
		const received = collectFrames(daemonSocket);

		const { socket: internalSocket, restore } = forceBackpressureOnce(client);

		try {
			// Trigger backpressure so subsequent messages queue.
			client.write("term-1", "trigger-backpressure");

			// Control frames must never vanish silently, but they also must not
			// grow the queue without bound while the daemon is not reading: once
			// the budget is exhausted the create must reject so the caller can
			// roll back and surface the error to the renderer.
			const bigEnv = { PAYLOAD: "x".repeat(30_000) };
			let queueFullError: Error | null = null;
			let acceptedCreates = 0;
			for (let i = 0; i < 30 && !queueFullError; i++) {
				try {
					await client.create(
						`crowded-${i}`,
						"/tmp",
						() => {},
						() => {},
						bigEnv
					);
					acceptedCreates++;
				} catch (err) {
					queueFullError = err as Error;
				}
			}
			expect(queueFullError).not.toBeNull();
			expect(String(queueFullError)).toContain("queue full");
			// The rejected create must be rolled back so a retry is possible.
			expect(client.hasLiveSession(`crowded-${acceptedCreates}`)).toBe(false);

			// Droppable traffic hitting the full queue still degrades silently.
			expect(() => client.write("term-1", "still-silent")).not.toThrow();

			internalSocket.emit("drain");
			await new Promise<void>((r) => setTimeout(r, 200));

			// Every accepted control frame must reach the daemon.
			const createIds = received.filter((m) => m["type"] === "create").map((m) => m["id"]);
			for (let i = 0; i < acceptedCreates; i++) {
				expect(createIds).toContain(`crowded-${i}`);
			}
		} finally {
			restore();
		}
	});

	test("chunks an oversized write into multiple frames that all arrive in order", async () => {
		const daemonSocket = daemon.lastSocket();
		expect(daemonSocket).not.toBeNull();
		if (!daemonSocket) return;
		const received = collectFrames(daemonSocket);

		// Well past the 64KB frame limit — sent as one frame the daemon would
		// silently discard it, so the client must split it.
		const payload = `start-${"x".repeat(150_000)}-end`;
		client.write("term-1", payload);

		await new Promise<void>((r) => setTimeout(r, 300));

		const writes = received.filter((m) => m["type"] === "write" && m["id"] === "term-1");
		expect(writes.length).toBeGreaterThan(1);
		expect(writes.map((m) => m["data"]).join("")).toBe(payload);
	});

	test("re-attach send failure propagates so callbacks survive for the next reconnect", async () => {
		let exitCode: number | null = null;
		await client.attach(
			"term-1",
			() => {},
			(code) => {
				exitCode = code;
			}
		);

		// Simulate the socket dying between the sessions reply and the re-attach
		// loop: the attach send throws. The failure must reject connect() (so the
		// reconnect loop retries) instead of killing the tab via onExit(-1).
		const internals = client as unknown as { send: (msg: { type: string }) => void };
		const originalSend = internals.send.bind(client);
		internals.send = (msg: { type: string }) => {
			if (msg.type === "attach") throw new Error("Daemon not connected");
			originalSend(msg);
		};
		try {
			await expect(client.connect()).rejects.toThrow("Daemon not connected");
		} finally {
			internals.send = originalSend;
		}

		expect(exitCode).toBeNull();
		expect(client.getCallbackIds()).toContain("term-1");
	});

	test("create rejects when its frame exceeds the daemon frame limit", async () => {
		// The daemon discards inbound frames over 64KB without replying, so the
		// client must reject rather than transmit a frame that can never land.
		const hugeEnv = { PAYLOAD: "x".repeat(100_000) };
		await expect(
			client.create(
				"huge-message",
				"/tmp",
				() => {},
				() => {},
				hugeEnv
			)
		).rejects.toThrow("frame limit");
		// Local state must be rolled back so a retry is possible.
		expect(client.hasLiveSession("huge-message")).toBe(false);

		// An oversized droppable frame is dropped with a warning, never a throw.
		expect(() => client.write("term-1", "x".repeat(100_000))).not.toThrow();
	});

	test("restarts a session-less stale daemon and the fresh connection stays up", async () => {
		const base = join(tmpdir(), `ss-stale-restart-${process.pid}-${Date.now()}`);
		const paths = { sock: `${base}.sock`, pid: `${base}.pid`, log: `${base}.log` };
		const script = `${base}-daemon.js`;
		writeMockDaemonScript(script);

		// Protocol-1 daemon with NO live sessions and a valid pid file: safe to
		// kill and replace.
		const v1Daemon = await startMockDaemon(undefined, [], paths.sock, null);
		const dummy = spawnDummyDaemonProcess();
		writeFileSync(paths.pid, String(dummy.pid));

		const staleClient = new DaemonClient(paths.sock, paths.pid, paths.log);
		try {
			await staleClient.connect("/tmp/fake.db", script);

			expect(staleClient.isConnected).toBe(true);
			// The stale daemon process was terminated...
			expect(isAlive(dummy.pid)).toBe(false);
			// ...and replaced by the freshly spawned one (which wrote its own pid).
			const newPid = Number(readFileSync(paths.pid, "utf-8").trim());
			expect(newPid).not.toBe(dummy.pid);
			expect(isAlive(newPid)).toBe(true);

			// The fresh connection must survive leftover close events from the
			// restart — a stale reconnect timer must not tear it down.
			await new Promise<void>((r) => setTimeout(r, 1_500));
			expect(staleClient.isConnected).toBe(true);
		} finally {
			staleClient.disconnect();
			dummy.kill();
			try {
				const p = Number(readFileSync(paths.pid, "utf-8").trim());
				if (p && p !== dummy.pid) process.kill(p, "SIGKILL");
			} catch {}
			v1Daemon.server.close();
			for (const f of [...Object.values(paths), script]) {
				try {
					rmSync(f);
				} catch {}
			}
		}
	}, 15_000);

	test("keeps a stale daemon running when it still hosts live sessions", async () => {
		const base = join(tmpdir(), `ss-stale-busy-${process.pid}-${Date.now()}`);
		const paths = { sock: `${base}.sock`, pid: `${base}.pid`, log: `${base}.log` };
		const script = `${base}-daemon.js`;
		writeMockDaemonScript(script);

		// Protocol-1 daemon WITH a live session: restarting would kill the
		// user's running shell, so the client must stay on the stale daemon.
		const v1Daemon = await startMockDaemon(
			undefined,
			[{ id: "term-1", cwd: "/tmp", pid: 99 }],
			paths.sock,
			null
		);
		const dummy = spawnDummyDaemonProcess();
		writeFileSync(paths.pid, String(dummy.pid));

		const staleClient = new DaemonClient(paths.sock, paths.pid, paths.log);
		try {
			await staleClient.connect("/tmp/fake.db", script);

			expect(staleClient.isConnected).toBe(true);
			expect(staleClient.hasLiveSession("term-1")).toBe(true);
			expect(isAlive(dummy.pid)).toBe(true);
			expect(existsSync(paths.sock)).toBe(true);
		} finally {
			staleClient.disconnect();
			dummy.kill();
			v1Daemon.server.close();
			for (const f of [...Object.values(paths), script]) {
				try {
					rmSync(f);
				} catch {}
			}
		}
	}, 15_000);

	test("does not delete the socket of a stale daemon whose pid is unknown", async () => {
		const base = join(tmpdir(), `ss-stale-nopid-${process.pid}-${Date.now()}`);
		const paths = { sock: `${base}.sock`, pid: `${base}.pid`, log: `${base}.log` };
		const script = `${base}-daemon.js`;
		writeMockDaemonScript(script);

		// Protocol-1 daemon, no sessions, but its pid file is missing: killing is
		// impossible, so deleting its socket would orphan a live daemon and
		// spawning a second one would leak it. The client must stay connected.
		const v1Daemon = await startMockDaemon(undefined, [], paths.sock, null);

		const staleClient = new DaemonClient(paths.sock, paths.pid, paths.log);
		try {
			await staleClient.connect("/tmp/fake.db", script);

			expect(staleClient.isConnected).toBe(true);
			expect(existsSync(paths.sock)).toBe(true);
			// No replacement daemon was spawned (it would have written a pid file).
			expect(existsSync(paths.pid)).toBe(false);
		} finally {
			staleClient.disconnect();
			try {
				const p = Number(readFileSync(paths.pid, "utf-8").trim());
				if (p) process.kill(p, "SIGKILL");
			} catch {}
			v1Daemon.server.close();
			for (const f of [...Object.values(paths), script]) {
				try {
					rmSync(f);
				} catch {}
			}
		}
	}, 15_000);

	test("connects with a warning to a versionless daemon when it cannot restart it", async () => {
		// Protocol-1 daemon (no version in ready) and no spawn params: the client
		// must still connect rather than strand the user.
		const v1Socket = join(tmpdir(), `superiorswarm-v1-test-${process.pid}.sock`);
		const v1Pid = join(tmpdir(), `superiorswarm-v1-test-${process.pid}.pid`);
		const v1Log = join(tmpdir(), `superiorswarm-v1-test-${process.pid}.log`);
		if (existsSync(v1Socket)) rmSync(v1Socket);

		const v1Daemon = await startMockDaemon(undefined, undefined, v1Socket, null);
		const v1Client = new DaemonClient(v1Socket, v1Pid, v1Log);
		try {
			await v1Client.connect();
			expect(v1Client.isConnected).toBe(true);
			expect(v1Client.hasLiveSession("term-1")).toBe(true);
		} finally {
			v1Client.disconnect();
			v1Daemon.server.close();
			if (existsSync(v1Socket)) rmSync(v1Socket);
		}
	});

	test("fallback create resends the stored env and failure surfaces onExit(-1)", async () => {
		const daemonSocket = daemon.lastSocket();
		expect(daemonSocket).not.toBeNull();
		if (!daemonSocket) return;
		const received = collectFrames(daemonSocket);

		// Attach with env small enough to send but recorded for the fallback.
		const env = { AGENT_NOTIFY_SESSION_ID: "term-1", AGENT_NOTIFY_PORT: "1234" };
		await client.attach(
			"term-1",
			() => {},
			() => {},
			"/tmp",
			env
		);

		// Daemon reports the session gone → client falls back to create, which
		// must carry the original env so the respawned shell keeps agent hooks.
		daemonSocket.write(
			`${JSON.stringify({ type: "error", id: "term-1", message: "session not found" })}\n`
		);
		await new Promise<void>((r) => setTimeout(r, 100));

		const fallbackCreate = received.find((m) => m["type"] === "create" && m["id"] === "term-1") as
			| Record<string, unknown>
			| undefined;
		expect(fallbackCreate).toBeDefined();
		expect(fallbackCreate?.["env"]).toEqual(env);

		// Now the failure path: attach with an env too large for the fallback
		// create frame. The failed fallback must surface as onExit(-1) and clear
		// state instead of leaving a frozen tab.
		let exitCode: number | null = null;
		await client.attach(
			"term-2",
			() => {},
			(code) => {
				exitCode = code;
			},
			"/tmp",
			{ PAYLOAD: "x".repeat(100_000) }
		);
		daemonSocket.write(
			`${JSON.stringify({ type: "error", id: "term-2", message: "session not found" })}\n`
		);
		await new Promise<void>((r) => setTimeout(r, 100));

		expect(exitCode).toBe(-1);
		expect(client.getCallbackIds()).not.toContain("term-2");
	});

	test("refuses to hijack daemon owned by another app dir hash", async () => {
		const noSocket = join(tmpdir(), `superiorswarm-owner-test-${process.pid}.sock`);
		const noPid = join(tmpdir(), `superiorswarm-owner-test-${process.pid}.pid`);
		const noLog = join(tmpdir(), `superiorswarm-owner-test-${process.pid}.log`);
		const ownerPath = join(tmpdir(), `superiorswarm-owner-test-${process.pid}.owner`);

		if (existsSync(noSocket)) rmSync(noSocket);
		if (existsSync(noPid)) rmSync(noPid);
		if (existsSync(noLog)) rmSync(noLog);
		if (existsSync(ownerPath)) rmSync(ownerPath);

		const foreignHash = "ffffffffffff";
		writeFileSync(
			ownerPath,
			JSON.stringify({
				pid: process.pid,
				startedAtMs: Date.now(),
				appDirHash: foreignHash,
			})
		);

		const guardedClient = new DaemonClient(
			noSocket,
			noPid,
			noLog,
			false,
			ownerPath,
			"000000000000"
		);

		await expect(guardedClient.connect("/tmp/test.db", "/tmp/daemon.js")).rejects.toThrow(
			DaemonOwnershipMismatchError
		);

		guardedClient.disconnect();
		if (existsSync(noSocket)) rmSync(noSocket);
		if (existsSync(noPid)) rmSync(noPid);
		if (existsSync(noLog)) rmSync(noLog);
		if (existsSync(ownerPath)) rmSync(ownerPath);
	});

	test("onData receives replay metadata for scrollback messages", async () => {
		const received: Array<{ data: string; meta: TerminalDataMeta | undefined }> = [];

		await client.attach(
			"term-1",
			(data, meta) => {
				received.push({ data, meta });
			},
			() => {}
		);

		const sock = daemon.lastSocket();
		expect(sock).not.toBeNull();
		if (!sock) return;

		// Send a replay-tagged data message followed by a live data message
		const replayData = Buffer.from("old").toString("base64");
		const liveData = Buffer.from("new").toString("base64");
		sock.write(
			`${JSON.stringify({ type: "data", id: "term-1", data: replayData, replay: true, fg: "zsh" })}\n`
		);
		sock.write(`${JSON.stringify({ type: "data", id: "term-1", data: liveData })}\n`);

		await new Promise<void>((r) => setTimeout(r, 80));

		expect(received).toHaveLength(2);
		expect(received[0]).toEqual({ data: "old", meta: { replay: true, fg: "zsh" } });
		expect(received[1]).toEqual({ data: "new", meta: undefined });
	});

	test("sends per-session detach frames to a current-protocol daemon", async () => {
		const received: Array<Record<string, unknown>> = [];
		const sock = daemon.lastSocket();
		expect(sock).not.toBeNull();
		if (!sock) return;
		sock.on("data", (chunk) => {
			for (const line of chunk.toString().split("\n")) {
				if (!line.trim()) continue;
				try {
					received.push(JSON.parse(line));
				} catch {}
			}
		});

		client.detach("term-1");
		await new Promise<void>((r) => setTimeout(r, 80));

		const detaches = received.filter((m) => m["type"] === "detach");
		expect(detaches).toHaveLength(1);
		expect(detaches[0]?.["id"]).toBe("term-1");
	});

	test("suppresses per-session detach frames to a v1 daemon", async () => {
		const base = join(tmpdir(), `ss-v1-detach-${process.pid}-${Date.now()}`);
		const paths = { sock: `${base}.sock`, pid: `${base}.pid`, log: `${base}.log` };
		const script = `${base}-daemon.js`;
		writeMockDaemonScript(script);

		// v1 daemon WITH a live session: the client keeps it rather than restart.
		const received: Array<Record<string, unknown>> = [];
		const v1Daemon = await startMockDaemon(
			(msg) => received.push(msg as Record<string, unknown>),
			[{ id: "term-1", cwd: "/tmp", pid: 99 }],
			paths.sock,
			null
		);
		const dummy = spawnDummyDaemonProcess();
		writeFileSync(paths.pid, String(dummy.pid));

		const v1Client = new DaemonClient(paths.sock, paths.pid, paths.log);
		try {
			await v1Client.connect("/tmp/fake.db", script);
			expect(v1Client.hasLiveSession("term-1")).toBe(true);

			// A v1 daemon executes any per-session detach as detach-client-from-ALL
			// sessions — every other tab would silently freeze. The client must
			// drop its callbacks locally instead of sending the frame.
			v1Client.detach("term-1");
			await new Promise<void>((r) => setTimeout(r, 100));

			expect(received.filter((m) => m["type"] === "detach")).toHaveLength(0);
			expect(v1Client.getCallbackIds()).not.toContain("term-1");
		} finally {
			v1Client.disconnect();
			dummy.kill();
			v1Daemon.server.close();
			for (const f of [...Object.values(paths), script]) {
				try {
					rmSync(f);
				} catch {}
			}
		}
	}, 15_000);

	test("translates detach-all to the v1 wire form for a v1 daemon", async () => {
		const base = join(tmpdir(), `ss-v1-detachall-${process.pid}-${Date.now()}`);
		const paths = { sock: `${base}.sock`, pid: `${base}.pid`, log: `${base}.log` };
		const script = `${base}-daemon.js`;
		writeMockDaemonScript(script);

		const received: Array<Record<string, unknown>> = [];
		const v1Daemon = await startMockDaemon(
			(msg) => received.push(msg as Record<string, unknown>),
			[{ id: "term-1", cwd: "/tmp", pid: 99 }],
			paths.sock,
			null
		);
		const dummy = spawnDummyDaemonProcess();
		writeFileSync(paths.pid, String(dummy.pid));

		const v1Client = new DaemonClient(paths.sock, paths.pid, paths.log);
		try {
			await v1Client.connect("/tmp/fake.db", script);

			// v1 daemons have no "detach-all" handler; their "detach" IS
			// detach-client-from-all. Send that instead of a frame they ignore.
			v1Client.detachAll();
			await new Promise<void>((r) => setTimeout(r, 100));

			expect(received.filter((m) => m["type"] === "detach-all")).toHaveLength(0);
			expect(received.filter((m) => m["type"] === "detach")).toHaveLength(1);
		} finally {
			v1Client.disconnect();
			dummy.kill();
			v1Daemon.server.close();
			for (const f of [...Object.values(paths), script]) {
				try {
					rmSync(f);
				} catch {}
			}
		}
	}, 15_000);

	test("fetches the session list only once when keeping a stale v1 daemon", async () => {
		const base = join(tmpdir(), `ss-v1-onelist-${process.pid}-${Date.now()}`);
		const paths = { sock: `${base}.sock`, pid: `${base}.pid`, log: `${base}.log` };
		const script = `${base}-daemon.js`;
		writeMockDaemonScript(script);

		const received: Array<Record<string, unknown>> = [];
		const v1Daemon = await startMockDaemon(
			(msg) => received.push(msg as Record<string, unknown>),
			[{ id: "term-1", cwd: "/tmp", pid: 99 }],
			paths.sock,
			null
		);
		const dummy = spawnDummyDaemonProcess();
		writeFileSync(paths.pid, String(dummy.pid));

		const v1Client = new DaemonClient(paths.sock, paths.pid, paths.log);
		try {
			await v1Client.connect("/tmp/fake.db", script);
			expect(v1Client.hasLiveSession("term-1")).toBe(true);

			// The version check already fetched the session list; fetching it a
			// second time doubles connect latency on every reconnect to this daemon.
			expect(received.filter((m) => m["type"] === "list")).toHaveLength(1);
		} finally {
			v1Client.disconnect();
			dummy.kill();
			v1Daemon.server.close();
			for (const f of [...Object.values(paths), script]) {
				try {
					rmSync(f);
				} catch {}
			}
		}
	}, 15_000);

	test("daemon-reported create error surfaces onExit(-1) instead of a frozen tab", async () => {
		const daemonSocket = daemon.lastSocket();
		expect(daemonSocket).not.toBeNull();
		if (!daemonSocket) return;

		let exitCode: number | null = null;
		await client.create(
			"bad-term",
			"/nonexistent-cwd",
			() => {},
			(code) => {
				exitCode = code;
			}
		);

		// e.g. pty.spawn threw in the daemon because the cwd no longer exists.
		daemonSocket.write(
			`${JSON.stringify({ type: "error", id: "bad-term", message: "Error: spawn failed" })}\n`
		);
		await new Promise<void>((r) => setTimeout(r, 100));

		expect(exitCode).toBe(-1);
		expect(client.hasLiveSession("bad-term")).toBe(false);
		expect(client.getCallbackIds()).not.toContain("bad-term");
	});

	test("drops a chunked paste whole when the queue cannot hold every chunk", async () => {
		const daemonSocket = daemon.lastSocket();
		expect(daemonSocket).not.toBeNull();
		if (!daemonSocket) return;
		const received = collectFrames(daemonSocket);

		const { socket: internalSocket, restore } = forceBackpressureOnce(client);

		try {
			client.write("term-1", "primer");
			// ~302KB of filler queued ahead of the paste.
			for (let i = 0; i < 50; i++) {
				client.write("term-1", "F".repeat(6_000));
			}
			// ~300KB paste → ~5 chunks; only ~3 fit the remaining budget. Partial
			// delivery would hand the shell a spliced command, so ALL must drop.
			client.write("term-1", "p".repeat(300_000));

			internalSocket.emit("drain");
			await new Promise<void>((r) => setTimeout(r, 300));

			const pasteFrames = received.filter(
				(m) => m["type"] === "write" && String(m["data"]).includes("ppp")
			);
			expect(pasteFrames).toHaveLength(0);
			// The filler that fit must still be delivered.
			const fillerFrames = received.filter(
				(m) => m["type"] === "write" && String(m["data"]).includes("FFF")
			);
			expect(fillerFrames.length).toBeGreaterThan(0);
		} finally {
			restore();
		}
	});

	test("evicts a queued chunked paste as a whole group for a control frame", async () => {
		const daemonSocket = daemon.lastSocket();
		expect(daemonSocket).not.toBeNull();
		if (!daemonSocket) return;
		const received = collectFrames(daemonSocket);

		const { socket: internalSocket, restore } = forceBackpressureOnce(client);

		try {
			client.write("term-1", "primer");
			// Paste queues first (~300KB in ~5 chunks), then ~180KB of filler.
			client.write("term-1", "p".repeat(300_000));
			for (let i = 0; i < 30; i++) {
				client.write("term-1", "F".repeat(6_000));
			}
			// A control frame that needs ~60KB of room: eviction starts at the
			// oldest droppable — the paste's first chunk. Evicting only that chunk
			// would deliver the paste with its head missing.
			await client.create(
				"ctl-term",
				"/tmp",
				() => {},
				() => {},
				{ PAYLOAD: "x".repeat(55_000) }
			);

			internalSocket.emit("drain");
			await new Promise<void>((r) => setTimeout(r, 300));

			const pasteFrames = received.filter(
				(m) => m["type"] === "write" && String(m["data"]).includes("ppp")
			);
			expect(pasteFrames).toHaveLength(0);
			expect(received.some((m) => m["type"] === "create" && m["id"] === "ctl-term")).toBe(true);
		} finally {
			restore();
		}
	});

	test("reassembles a multibyte paste across chunked frames without corruption", async () => {
		const daemonSocket = daemon.lastSocket();
		expect(daemonSocket).not.toBeNull();
		if (!daemonSocket) return;
		const received = collectFrames(daemonSocket);

		// 80,000 UTF-16 units / ~160KB UTF-8 — forces multiple chunks whose
		// boundaries must not split surrogate pairs.
		const payload = "🐟".repeat(40_000);
		client.write("term-1", payload);

		await new Promise<void>((r) => setTimeout(r, 300));

		const writes = received.filter((m) => m["type"] === "write" && m["id"] === "term-1");
		expect(writes.length).toBeGreaterThan(1);
		expect(writes.map((m) => m["data"]).join("")).toBe(payload);
		for (const w of writes) {
			const frameBytes = Buffer.byteLength(
				`${JSON.stringify({ type: "write", id: "term-1", data: w["data"] })}\n`,
				"utf-8"
			);
			expect(frameBytes).toBeLessThanOrEqual(64_000);
		}
	});

	test("decodes multibyte characters split across inbound socket chunks", async () => {
		const received: Array<{ data: string; meta: TerminalDataMeta | undefined }> = [];
		await client.attach(
			"term-1",
			(data, meta) => {
				received.push({ data, meta });
			},
			() => {}
		);

		const sock = daemon.lastSocket();
		expect(sock).not.toBeNull();
		if (!sock) return;

		const frame = Buffer.from(
			`${JSON.stringify({
				type: "data",
				id: "term-1",
				data: Buffer.from("hello").toString("base64"),
				replay: true,
				fg: "🐟fish",
			})}\n`,
			"utf-8"
		);
		// Split inside the 4-byte fish emoji: per-chunk toString() would decode
		// both halves to U+FFFD.
		const splitAt = frame.indexOf(Buffer.from("🐟")) + 2;
		sock.write(frame.subarray(0, splitAt));
		await new Promise<void>((r) => setTimeout(r, 50));
		sock.write(frame.subarray(splitAt));
		await new Promise<void>((r) => setTimeout(r, 100));

		expect(received).toHaveLength(1);
		expect(received[0]?.meta?.fg).toBe("🐟fish");
	});

	test("delivers a scrollback replay frame larger than 512KB intact", async () => {
		const received: string[] = [];
		await client.attach(
			"term-1",
			(data) => {
				received.push(data);
			},
			() => {}
		);

		const sock = daemon.lastSocket();
		expect(sock).not.toBeNull();
		if (!sock) return;

		// A full 200k-char scrollback of multibyte text base64-encodes to ~800KB
		// in a single legitimate daemon frame — it must not be discarded.
		const payload = "s".repeat(600_000);
		sock.write(
			`${JSON.stringify({
				type: "data",
				id: "term-1",
				data: Buffer.from(payload).toString("base64"),
				replay: true,
			})}\n`
		);
		await new Promise<void>((r) => setTimeout(r, 500));

		expect(received.join("")).toBe(payload);
	}, 10_000);

	test("allows foreign owner record when startedAtMs is obviously invalid", () => {
		const ownerPath = join(tmpdir(), `superiorswarm-owner-invalid-${process.pid}.owner`);
		const noSocket = join(tmpdir(), `superiorswarm-owner-invalid-${process.pid}.sock`);
		const noPid = join(tmpdir(), `superiorswarm-owner-invalid-${process.pid}.pid`);
		const noLog = join(tmpdir(), `superiorswarm-owner-invalid-${process.pid}.log`);

		if (existsSync(ownerPath)) rmSync(ownerPath);
		if (existsSync(noSocket)) rmSync(noSocket);
		if (existsSync(noPid)) rmSync(noPid);
		if (existsSync(noLog)) rmSync(noLog);

		writeFileSync(
			ownerPath,
			JSON.stringify({
				pid: process.pid,
				startedAtMs: Date.now() + 120_000,
				appDirHash: "foreignhash",
			})
		);

		const guardedClient = new DaemonClient(noSocket, noPid, noLog, false, ownerPath, "localhash");

		expect(() =>
			(
				guardedClient as unknown as { assertOwnershipCompatible: () => void }
			).assertOwnershipCompatible()
		).not.toThrow();

		if (existsSync(ownerPath)) rmSync(ownerPath);
		if (existsSync(noSocket)) rmSync(noSocket);
		if (existsSync(noPid)) rmSync(noPid);
		if (existsSync(noLog)) rmSync(noLog);
	});
});
