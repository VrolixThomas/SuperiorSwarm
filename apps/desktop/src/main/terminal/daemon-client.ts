import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { type Socket, connect } from "node:net";
import { join } from "node:path";
import {
	BRANCHFLUX_DIR,
	type ClientMessage,
	type DaemonMessage,
} from "../../shared/daemon-protocol";
const DEFAULT_SOCKET_PATH = join(BRANCHFLUX_DIR, "daemon.sock");
const PID_PATH = join(BRANCHFLUX_DIR, "daemon.pid");
const CONNECT_TIMEOUT_MS = 5_000;
const CONNECT_POLL_MS = 100;

interface TerminalCallbacks {
	onData: (data: string) => void;
	onExit: (code: number) => void;
	cwd?: string;
}

export class DaemonClient {
	private socket: Socket | null = null;
	private lineBuffer = "";
	private liveSessions = new Set<string>();
	private callbacks = new Map<string, TerminalCallbacks>();
	private pendingListeners = new Map<string, Array<(msg: DaemonMessage) => void>>();
	private isQuitting = false;
	// Sessions that were attached (background PTYs) rather than freshly created.
	// These must not be killed on dispose — they survive tab close and app restarts.
	private attachedSessions = new Set<string>();

	constructor(private socketPath: string = DEFAULT_SOCKET_PATH) {}

	async connect(dbPath?: string, daemonScriptPath?: string): Promise<void> {
		try {
			await this.tryConnect();
		} catch {
			if (!dbPath || !daemonScriptPath) {
				throw new Error("Daemon not running and no spawn params provided");
			}
			await this.spawnDaemon(dbPath, daemonScriptPath);
			await this.waitForSocket();
			await this.tryConnect();
		}

		// Wait for the ready message
		await this.waitForMessage("ready");

		// Request and cache the live session list
		this.send({ type: "list" });
		const sessionsMsg = await this.waitForMessage("sessions");
		if (sessionsMsg.type === "sessions") {
			for (const s of sessionsMsg.sessions) {
				this.liveSessions.add(s.id);
			}
		}
	}

	disconnect(): void {
		this.socket?.destroy();
		this.socket = null;
	}

	hasLiveSession(id: string): boolean {
		return this.liveSessions.has(id);
	}

	setQuitting(): void {
		this.isQuitting = true;
	}

	detachAll(): void {
		this.send({ type: "detach-all" });
	}

	async create(
		id: string,
		cwd: string | undefined,
		onData: (data: string) => void,
		onExit: (code: number) => void
	): Promise<void> {
		this.attachedSessions.delete(id);
		this.callbacks.set(id, { onData, onExit, cwd });
		this.liveSessions.add(id);
		this.send({ type: "create", id, cwd });
	}

	async attach(
		id: string,
		onData: (data: string) => void,
		onExit: (code: number) => void,
		cwd?: string
	): Promise<void> {
		this.attachedSessions.add(id);
		this.callbacks.set(id, { onData, onExit, cwd });
		this.send({ type: "attach", id });
	}

	write(id: string, data: string): void {
		this.send({ type: "write", id, data });
	}

	resize(id: string, cols: number, rows: number): void {
		this.send({ type: "resize", id, cols, rows });
	}

	dispose(id: string): void {
		if (this.isQuitting) return;
		const wasAttached = this.attachedSessions.has(id);
		this.callbacks.delete(id);
		this.attachedSessions.delete(id);
		if (wasAttached) {
			// Background session — drop local callbacks but keep the id in liveSessions
			// so the next terminal:create IPC call uses attach (not create).
			// The PTY continues running in the daemon unaffected.
			return;
		}
		this.liveSessions.delete(id);
		this.send({ type: "dispose", id });
	}

	private send(msg: ClientMessage): void {
		if (this.socket && !this.socket.destroyed) {
			this.socket.write(`${JSON.stringify(msg)}\n`);
		}
	}

	private setupMessageHandler(): void {
		if (!this.socket) return;

		this.socket.on("data", (chunk) => {
			this.lineBuffer += chunk.toString("utf-8");
			if (this.lineBuffer.length > 64_000) {
				console.warn("[daemon-client] line buffer overflow, resetting");
				this.lineBuffer = "";
				return;
			}
			let newline: number;
			for (;;) {
				newline = this.lineBuffer.indexOf("\n");
				if (newline === -1) break;
				const line = this.lineBuffer.slice(0, newline).trim();
				this.lineBuffer = this.lineBuffer.slice(newline + 1);
				if (!line) continue;
				try {
					const msg = JSON.parse(line) as DaemonMessage;
					this.handleMessage(msg);
				} catch {
					console.warn("[daemon-client] failed to parse message");
				}
			}
		});

		this.socket.on("close", () => {
			console.warn("[daemon-client] connection to daemon lost");
		});

		this.socket.on("error", (err) => {
			console.error("[daemon-client] socket error:", err.message);
		});
	}

	private handleMessage(msg: DaemonMessage): void {
		// Resolve pending one-shot listeners first
		const pending = this.pendingListeners.get(msg.type);
		if (pending && pending.length > 0) {
			const handler = pending.shift()!;
			if (pending.length === 0) this.pendingListeners.delete(msg.type);
			handler(msg);
			return;
		}

		switch (msg.type) {
			case "data": {
				const cb = this.callbacks.get(msg.id);
				if (cb) {
					cb.onData(Buffer.from(msg.data, "base64").toString("utf-8"));
				}
				break;
			}
			case "exit": {
				const cb = this.callbacks.get(msg.id);
				if (cb) {
					cb.onExit(msg.code);
					this.callbacks.delete(msg.id);
					this.liveSessions.delete(msg.id);
				}
				break;
			}
			case "error": {
				console.error(`[daemon-client] error for terminal ${msg.id}: ${msg.message}`);
				// If attach failed because the session wasn't found, fall back to create
				if (msg.message === "session not found" && this.callbacks.has(msg.id)) {
					const stored = this.callbacks.get(msg.id);
					this.send({ type: "create", id: msg.id, cwd: stored?.cwd });
				}
				break;
			}
		}
	}

	private waitForMessage<T extends DaemonMessage["type"]>(
		type: T,
		timeoutMs = 5_000
	): Promise<Extract<DaemonMessage, { type: T }>> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				const pending = this.pendingListeners.get(type);
				if (pending) {
					const idx = pending.indexOf(handler);
					if (idx !== -1) pending.splice(idx, 1);
					if (pending.length === 0) this.pendingListeners.delete(type);
				}
				reject(new Error(`Timed out waiting for daemon message: ${type}`));
			}, timeoutMs);
			const handler = (msg: DaemonMessage) => {
				clearTimeout(timer);
				resolve(msg as Extract<DaemonMessage, { type: T }>);
			};
			const listeners = this.pendingListeners.get(type) ?? [];
			listeners.push(handler);
			this.pendingListeners.set(type, listeners);
		});
	}

	private tryConnect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const socket = connect(this.socketPath);
			socket.once("connect", () => {
				this.socket = socket;
				this.setupMessageHandler();
				resolve();
			});
			socket.once("error", reject);
		});
	}

	private async spawnDaemon(dbPath: string, daemonScriptPath: string): Promise<void> {
		if (!existsSync(BRANCHFLUX_DIR)) {
			mkdirSync(BRANCHFLUX_DIR, { recursive: true });
		}

		// Check for stale PID — if the process still exists, wait for it to bind
		if (existsSync(PID_PATH)) {
			try {
				const pid = Number(readFileSync(PID_PATH, "utf-8").trim());
				if (pid) {
					try {
						process.kill(pid, 0); // throws if process doesn't exist
						return; // process exists, let waitForSocket handle the rest
					} catch {
						// process is gone, clean up stale file
						try {
							rmSync(PID_PATH);
						} catch {}
					}
				}
			} catch {}
		}

		const logPath = join(BRANCHFLUX_DIR, "daemon.log");
		const logFd = openSync(logPath, "a");
		const child = spawn(process.execPath, [daemonScriptPath], {
			detached: true,
			stdio: ["ignore", logFd, logFd],
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1",
				BRANCHFLUX_DB_PATH: dbPath,
			},
		});
		child.unref();
		closeSync(logFd);
	}

	private async waitForSocket(): Promise<void> {
		const deadline = Date.now() + CONNECT_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (existsSync(this.socketPath)) return;
			await new Promise<void>((r) => setTimeout(r, CONNECT_POLL_MS));
		}
		throw new Error(`Daemon socket did not appear within ${CONNECT_TIMEOUT_MS}ms`);
	}
}

export const daemonClient = new DaemonClient();
