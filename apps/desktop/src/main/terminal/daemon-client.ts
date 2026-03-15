import { spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { type Socket, connect } from "node:net";
import {
	BRANCHFLUX_DIR,
	type ClientMessage,
	type DaemonMessage,
} from "../../shared/daemon-protocol";
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
	private reconnecting = false;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private dbPath: string | undefined;
	private daemonScriptPath: string | undefined;
	private onConnectionStatusChange: ((connected: boolean) => void) | null = null;

	constructor(
		private socketPath: string,
		private pidPath: string,
		private logPath: string
	) {}

	get isConnected(): boolean {
		return this.socket !== null && !this.socket.destroyed;
	}

	setConnectionStatusCallback(cb: (connected: boolean) => void): void {
		this.onConnectionStatusChange = cb;
	}

	async connect(dbPath?: string, daemonScriptPath?: string): Promise<void> {
		this.dbPath = dbPath;
		this.daemonScriptPath = daemonScriptPath;

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
		this.liveSessions.clear();
		this.send({ type: "list" });
		const sessionsMsg = await this.waitForMessage("sessions");
		if (sessionsMsg.type === "sessions") {
			for (const s of sessionsMsg.sessions) {
				this.liveSessions.add(s.id);
			}
		}

		// Re-attach sessions that have active callbacks after reconnect.
		// Sessions still alive in the daemon get a fresh attach message;
		// sessions that died while disconnected get an onExit(-1) cleanup.
		for (const [id, cb] of this.callbacks) {
			if (this.liveSessions.has(id)) {
				this.send({ type: "attach", id });
			} else {
				cb.onExit(-1);
				this.callbacks.delete(id);
				this.attachedSessions.delete(id);
			}
		}

		this.reconnectAttempts = 0;
		this.onConnectionStatusChange?.(true);
	}

	disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.reconnecting = false;
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
		try {
			this.send({ type: "detach-all" });
		} catch {
			// Best effort — if the socket is already gone, there's nothing to detach from
		}
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
		try {
			this.send({ type: "create", id, cwd });
		} catch (err) {
			// Roll back local state if we couldn't reach the daemon
			this.callbacks.delete(id);
			this.liveSessions.delete(id);
			throw err;
		}
	}

	async attach(
		id: string,
		onData: (data: string) => void,
		onExit: (code: number) => void,
		cwd?: string
	): Promise<void> {
		this.attachedSessions.add(id);
		this.callbacks.set(id, { onData, onExit, cwd });
		try {
			this.send({ type: "attach", id });
		} catch (err) {
			// Roll back local state if we couldn't reach the daemon
			this.callbacks.delete(id);
			this.attachedSessions.delete(id);
			throw err;
		}
	}

	write(id: string, data: string): void {
		if (!this.isConnected) return;
		this.send({ type: "write", id, data });
	}

	resize(id: string, cols: number, rows: number): void {
		if (!this.isConnected) return;
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
		try {
			this.send({ type: "dispose", id });
		} catch {
			// Best effort — the PTY will be cleaned up by idle timeout if unreachable
		}
	}

	private attemptReconnect(): void {
		if (this.reconnecting || this.isQuitting) return;
		this.reconnecting = true;
		this.reconnectAttempts++;

		if (this.reconnectAttempts > this.maxReconnectAttempts) {
			console.error("[daemon-client] max reconnection attempts reached, giving up");
			this.reconnecting = false;
			return;
		}

		const backoffMs = Math.min(1_000 * 2 ** (this.reconnectAttempts - 1), 30_000);
		console.log(
			`[daemon-client] reconnecting in ${backoffMs}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
		);

		this.reconnectTimer = setTimeout(async () => {
			try {
				this.socket?.destroy();
				this.socket = null;
				this.lineBuffer = "";
				this.pendingListeners.clear();

				await this.connect(this.dbPath, this.daemonScriptPath);

				this.reconnecting = false;
				this.reconnectAttempts = 0;
				console.log("[daemon-client] reconnected to daemon");
			} catch (err) {
				console.error("[daemon-client] reconnection failed:", err);
				this.reconnecting = false;
				this.attemptReconnect();
			}
		}, backoffMs);
	}

	private send(msg: ClientMessage): void {
		if (!this.socket || this.socket.destroyed) {
			throw new Error("Daemon not connected");
		}
		const ok = this.socket.write(`${JSON.stringify(msg)}\n`);
		if (!ok) {
			console.warn("[daemon-client] socket backpressure detected");
		}
	}

	private setupMessageHandler(): void {
		if (!this.socket) return;

		this.socket.on("data", (chunk) => {
			this.lineBuffer += chunk.toString("utf-8");
			if (this.lineBuffer.length > 512_000) {
				console.warn("[daemon-client] line buffer overflow, resetting");
				// Try to salvage: find the last newline and keep everything after it
				const lastNewline = this.lineBuffer.lastIndexOf("\n");
				if (lastNewline !== -1) {
					this.lineBuffer = this.lineBuffer.slice(lastNewline + 1);
				} else {
					this.lineBuffer = "";
				}
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
			this.onConnectionStatusChange?.(false);
			this.attemptReconnect();
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
		if (existsSync(this.pidPath)) {
			try {
				const pid = Number(readFileSync(this.pidPath, "utf-8").trim());
				if (pid) {
					try {
						process.kill(pid, 0); // throws if process doesn't exist
						return; // process exists, let waitForSocket handle the rest
					} catch {
						// process is gone, clean up stale file
						try {
							rmSync(this.pidPath);
						} catch {}
					}
				}
			} catch {}
		}

		// Truncate log to prevent unbounded growth across daemon restarts
		const MAX_LOG_BYTES = 50_000;
		try {
			if (existsSync(this.logPath)) {
				const stat = statSync(this.logPath);
				if (stat.size > MAX_LOG_BYTES) {
					const content = readFileSync(this.logPath, "utf-8");
					writeFileSync(this.logPath, content.slice(-MAX_LOG_BYTES));
				}
			}
		} catch {}

		const logFd = openSync(this.logPath, "a");
		const child = spawn(process.execPath, [daemonScriptPath], {
			detached: true,
			stdio: ["ignore", logFd, logFd],
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1",
				BRANCHFLUX_DB_PATH: dbPath,
				BRANCHFLUX_SOCKET_PATH: this.socketPath,
				BRANCHFLUX_PID_PATH: this.pidPath,
				BRANCHFLUX_LOG_PATH: this.logPath,
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
