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
	type ClientMessage,
	type DaemonMessage,
	SUPERIORSWARM_DIR,
} from "../../shared/daemon-protocol";
import {
	DaemonOwnershipMismatchError,
	isDaemonOwnershipMismatchError,
	isOwnerRecordCurrent,
	isPidAlive,
	parseOwnerRecord,
} from "./daemon-ownership";
const CONNECT_TIMEOUT_MS = 5_000;
const CONNECT_POLL_MS = 100;
const MAX_OUTBOUND_QUEUE_BYTES = 512_000;

interface OutboundQueueEntry {
	encoded: string;
	bytes: number;
	droppable: boolean;
	type: ClientMessage["type"];
	id?: string;
}

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
	private reconnecting = false;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 10;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private dbPath: string | undefined;
	private daemonScriptPath: string | undefined;
	private onConnectionStatusChange: ((connected: boolean) => void) | null = null;
	private outboundQueue: OutboundQueueEntry[] = [];
	private outboundQueuedBytes = 0;
	private waitingForDrain = false;
	private intentionalDisconnect = false;

	constructor(
		private socketPath: string,
		private pidPath: string,
		private logPath: string,
		private readonly devMode = false,
		private readonly ownerPath?: string,
		private readonly appDirHash?: string
	) {}

	get isConnected(): boolean {
		return this.socket !== null && !this.socket.destroyed;
	}

	setConnectionStatusCallback(cb: (connected: boolean) => void): void {
		this.onConnectionStatusChange = cb;
	}

	async connect(dbPath?: string, daemonScriptPath?: string): Promise<void> {
		this.intentionalDisconnect = false;
		this.dbPath = dbPath;
		this.daemonScriptPath = daemonScriptPath;
		this.assertOwnershipCompatible();

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
			}
		}

		this.reconnectAttempts = 0;
		this.onConnectionStatusChange?.(true);
	}

	disconnect(): void {
		this.intentionalDisconnect = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.reconnecting = false;
		this.waitingForDrain = false;
		this.socket?.destroy();
		this.socket = null;
		this.resetOutboundQueue();
	}

	hasLiveSession(id: string): boolean {
		return this.liveSessions.has(id);
	}

	async listSessions(): Promise<Array<{ id: string; cwd: string; pid: number }>> {
		if (!this.isConnected) return [];
		this.send({ type: "list" });
		const msg = await this.waitForMessage("sessions");
		return msg.type === "sessions" ? msg.sessions : [];
	}

	getLiveSessions(): Set<string> {
		return new Set(this.liveSessions);
	}

	getCallbackIds(): string[] {
		return Array.from(this.callbacks.keys());
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
		onExit: (code: number) => void,
		env?: Record<string, string>
	): Promise<void> {
		this.callbacks.set(id, { onData, onExit, cwd });
		this.liveSessions.add(id);
		try {
			this.send({ type: "create", id, cwd, env });
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
		this.callbacks.set(id, { onData, onExit, cwd });
		try {
			this.send({ type: "attach", id });
		} catch (err) {
			this.callbacks.delete(id);
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

	/** Detach from a PTY without killing it. The PTY keeps running in the daemon. */
	detach(id: string): void {
		this.callbacks.delete(id);
		// Keep id in liveSessions so re-attach works on next create call
		try {
			this.send({ type: "detach", id });
		} catch {
			// Best effort
		}
	}

	/** Kill a PTY in the daemon. Used when the user explicitly closes a tab. */
	dispose(id: string): void {
		this.callbacks.delete(id);
		this.liveSessions.delete(id);
		try {
			this.send({ type: "dispose", id });
		} catch {
			// Best effort — daemon may already be gone
		}
	}

	/** Kick off the reconnection loop (e.g. after initial connect failure). */
	startReconnecting(): void {
		this.attemptReconnect();
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
				if (isDaemonOwnershipMismatchError(err)) {
					console.error("[daemon-client] daemon owned by another instance, stopping reconnect");
					this.reconnecting = false;
					return;
				}
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
		if (this.waitingForDrain || this.outboundQueue.length > 0) {
			this.enqueueOutbound(msg);
			return;
		}

		const encoded = `${JSON.stringify(msg)}\n`;
		const ok = this.socket.write(encoded);
		if (!ok) {
			this.waitingForDrain = true;
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

		this.socket.on("drain", () => {
			this.flushOutboundQueue();
		});

		this.socket.on("close", () => {
			if (this.intentionalDisconnect) {
				this.intentionalDisconnect = false;
				this.waitingForDrain = false;
				this.resetOutboundQueue();
				return;
			}
			console.warn("[daemon-client] connection to daemon lost");
			this.waitingForDrain = false;
			this.resetOutboundQueue();
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
		if (!existsSync(SUPERIORSWARM_DIR)) {
			mkdirSync(SUPERIORSWARM_DIR, { recursive: true });
		}

		// Check for stale PID — if the process still exists, wait for it to bind
		if (existsSync(this.pidPath)) {
			try {
				const pid = Number(readFileSync(this.pidPath, "utf-8").trim());
				if (pid) {
					if (isPidAlive(pid)) {
						return; // process exists, let waitForSocket handle the rest
					}
					// process is gone, clean up stale file
					try {
						rmSync(this.pidPath);
					} catch {}
				}
			} catch {}
		}

		// Remove stale socket so waitForSocket blocks until the new daemon creates one
		if (existsSync(this.socketPath)) {
			try {
				rmSync(this.socketPath);
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
				SUPERIORSWARM_DB_PATH: dbPath,
				SUPERIORSWARM_SOCKET_PATH: this.socketPath,
				SUPERIORSWARM_PID_PATH: this.pidPath,
				SUPERIORSWARM_OWNER_PATH: this.ownerPath,
				SUPERIORSWARM_APP_DIR_HASH: this.appDirHash,
				SUPERIORSWARM_LOG_PATH: this.logPath,
				SUPERIORSWARM_DEV_MODE: this.devMode ? "1" : "",
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

	private assertOwnershipCompatible(): void {
		if (!this.ownerPath || !this.appDirHash || !existsSync(this.ownerPath)) {
			return;
		}

		try {
			const ownerRaw = readFileSync(this.ownerPath, "utf-8");
			const ownerRecord = parseOwnerRecord(ownerRaw);
			if (!ownerRecord) {
				return;
			}

			if (ownerRecord.appDirHash === this.appDirHash) {
				return;
			}

			if (!isOwnerRecordCurrent(ownerRecord)) {
				return;
			}

			if (isPidAlive(ownerRecord.pid)) {
				throw new DaemonOwnershipMismatchError(ownerRecord, this.appDirHash);
			}
		} catch (err) {
			if (isDaemonOwnershipMismatchError(err)) {
				throw err;
			}
		}
	}

	private enqueueOutbound(msg: ClientMessage): void {
		const encoded = `${JSON.stringify(msg)}\n`;
		const messageBytes = Buffer.byteLength(encoded, "utf-8");
		const droppable = msg.type === "write" || msg.type === "resize";

		if (msg.type === "resize") {
			for (let i = 0; i < this.outboundQueue.length; i++) {
				const queued = this.outboundQueue[i];
				if (queued?.type === "resize" && queued.id === msg.id) {
					this.outboundQueuedBytes -= queued.bytes;
					this.outboundQueue.splice(i, 1);
					break;
				}
			}
		}

		if (messageBytes > MAX_OUTBOUND_QUEUE_BYTES) {
			console.warn(
				`[daemon-client] outbound message ${messageBytes}B exceeds queue limit ${MAX_OUTBOUND_QUEUE_BYTES}B; dropping message`
			);
			return;
		}

		if (!droppable) {
			this.evictDroppableForControl(messageBytes);
		}

		if (this.outboundQueuedBytes + messageBytes > MAX_OUTBOUND_QUEUE_BYTES) {
			console.warn(
				`[daemon-client] outbound queue full (${this.outboundQueuedBytes}/${MAX_OUTBOUND_QUEUE_BYTES}B); dropping message`
			);
			return;
		}

		this.outboundQueue.push({
			encoded,
			bytes: messageBytes,
			droppable,
			type: msg.type,
			id: "id" in msg ? msg.id : undefined,
		});
		this.outboundQueuedBytes += messageBytes;
	}

	private evictDroppableForControl(controlBytes: number): void {
		while (this.outboundQueuedBytes + controlBytes > MAX_OUTBOUND_QUEUE_BYTES) {
			const dropIndex = this.outboundQueue.findIndex((entry) => entry.droppable);
			if (dropIndex === -1) {
				break;
			}
			const dropped = this.outboundQueue.splice(dropIndex, 1)[0];
			if (dropped) {
				this.outboundQueuedBytes -= dropped.bytes;
				console.warn(
					`[daemon-client] outbound queue full (${this.outboundQueuedBytes}/${MAX_OUTBOUND_QUEUE_BYTES}B); dropping ${dropped.type} to prioritize control message`
				);
			}
		}
	}

	private flushOutboundQueue(): void {
		if (!this.socket || this.socket.destroyed) {
			this.waitingForDrain = false;
			this.resetOutboundQueue();
			return;
		}

		this.waitingForDrain = false;
		while (this.outboundQueue.length > 0) {
			const queued = this.outboundQueue[0];
			if (queued === undefined) {
				break;
			}
			this.outboundQueue.shift();
			this.outboundQueuedBytes -= queued.bytes;
			const ok = this.socket.write(queued.encoded);
			if (!ok) {
				this.waitingForDrain = true;
				console.warn("[daemon-client] socket backpressure detected while draining queue");
				break;
			}
		}
		if (this.outboundQueue.length === 0) {
			this.outboundQueuedBytes = 0;
		}
	}

	private resetOutboundQueue(): void {
		this.outboundQueue = [];
		this.outboundQueuedBytes = 0;
	}
}
