import { spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { type Socket, connect } from "node:net";
import { StringDecoder } from "node:string_decoder";
import {
	type ClientMessage,
	DAEMON_PROTOCOL_VERSION,
	type DaemonMessage,
	type DaemonSession,
	MAX_FRAME_BYTES,
	MAX_SCROLLBACK_CHARS,
	SUPERIORSWARM_DIR,
	type TerminalDataMeta,
} from "../../shared/daemon-protocol";
import {
	DaemonOwnershipMismatchError,
	isDaemonOwnershipMismatchError,
	isOwnerRecordCurrent,
	isPidAlive,
	parseOwnerRecord,
} from "./daemon-ownership";
import { readPidFile, removeFiles } from "./stale-daemon-cleanup";
const CONNECT_TIMEOUT_MS = 5_000;
const CONNECT_POLL_MS = 100;
const MAX_OUTBOUND_QUEUE_BYTES = 512_000;
// Upper bound for one partial daemon frame buffered client-side. The largest
// legitimate frame is a full-scrollback attach replay: MAX_SCROLLBACK_CHARS
// UTF-16 units at ≤3 UTF-8 bytes each, ×4/3 base64 expansion (= ×4 chars),
// plus the JSON envelope.
const MAX_INBOUND_BUFFER_CHARS = MAX_SCROLLBACK_CHARS * 4 + 4_096;

interface OutboundQueueEntry {
	encoded: string;
	bytes: number;
	droppable: boolean;
	type: ClientMessage["type"];
	id?: string;
	// Chunks of one logical write share a groupId so they are evicted together —
	// delivering a subset would hand the shell a spliced paste.
	groupId?: number;
}

interface TerminalCallbacks {
	onData: (data: string, meta?: TerminalDataMeta) => void;
	onExit: (code: number) => void;
	cwd?: string;
	// Kept so the "session not found" fallback create can respawn the shell
	// with the same environment (AGENT_NOTIFY_* etc.), not a bare one.
	env?: Record<string, string>;
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
	private writeGroupCounter = 0;
	// Protocol version reported by the connected daemon. Old (v1) daemons have
	// different wire semantics (per-session detach means detach-from-ALL), so
	// some frames must be suppressed or translated while one is kept alive.
	private remoteProtocolVersion = DAEMON_PROTOCOL_VERSION;

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
		await this.connectInternal(dbPath, daemonScriptPath, true);
	}

	private async connectInternal(
		dbPath: string | undefined,
		daemonScriptPath: string | undefined,
		allowStaleRestart: boolean
	): Promise<void> {
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

		const ready = await this.waitForMessage("ready");
		this.remoteProtocolVersion = ready.protocolVersion ?? 1;

		// The session list is needed both to decide whether a stale daemon can be
		// restarted and to seed liveSessions — fetch it once.
		let sessions: DaemonSession[] | null = null;
		if (ready.protocolVersion !== DAEMON_PROTOCOL_VERSION) {
			// A daemon from a previous app version survives upgrades (spawnDaemon
			// skips spawning while its pid is alive) and keeps its old behavior.
			// Restart it so protocol fixes actually reach the user — but only when
			// that cannot destroy user work: the stale daemon must host no live
			// sessions (killing it kills their shells) and its pid must be known
			// (deleting the socket under an unkillable daemon orphans it and leaks
			// a second daemon on the next spawn).
			const staleVersion = this.remoteProtocolVersion;
			if (allowStaleRestart && dbPath && daemonScriptPath) {
				// Read the pid before the list so the kill follows the zero-session
				// answer immediately — a session created by another client in that
				// remaining gap is an unavoidable race against a v1 daemon.
				const stalePid = this.readDaemonPid();
				this.send({ type: "list" });
				const staleSessions = await this.waitForMessage("sessions");
				sessions = staleSessions.type === "sessions" ? staleSessions.sessions : [];
				if (sessions.length === 0 && stalePid !== null) {
					console.warn(
						`[daemon-client] daemon speaks protocol v${staleVersion}, expected v${DAEMON_PROTOCOL_VERSION}; restarting daemon`
					);
					await this.killStaleDaemon(stalePid);
					await this.connectInternal(dbPath, daemonScriptPath, false);
					return;
				}
				console.warn(
					`[daemon-client] daemon speaks protocol v${staleVersion}, expected v${DAEMON_PROTOCOL_VERSION}; keeping it (${sessions.length} live sessions, pid ${stalePid ?? "unknown"})`
				);
			} else {
				console.warn(
					`[daemon-client] daemon speaks protocol v${staleVersion}, expected v${DAEMON_PROTOCOL_VERSION}; cannot restart (no spawn params)`
				);
			}
		}

		// Cache the live session list, reusing the version check's fetch if it
		// already made one.
		this.liveSessions.clear();
		if (sessions === null) {
			this.send({ type: "list" });
			const sessionsMsg = await this.waitForMessage("sessions");
			sessions = sessionsMsg.type === "sessions" ? sessionsMsg.sessions : [];
		}
		for (const s of sessions) {
			this.liveSessions.add(s.id);
		}

		// Re-attach sessions that have active callbacks after reconnect.
		// Sessions still alive in the daemon get a fresh attach message;
		// sessions that died while disconnected get an onExit(-1) cleanup.
		// An attach send failure means the connection itself is gone, so it
		// propagates: connect() rejects, the reconnect loop retries, and the
		// callbacks survive for that retry instead of being killed off.
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

	// Tear down the current socket and reset all per-connection state. Nulls
	// the socket field before destroying so the close handler recognizes the
	// teardown as intentional (socket identity mismatch) and does not reconnect.
	private teardownSocket(): void {
		const socket = this.socket;
		this.socket = null;
		socket?.destroy();
		this.lineBuffer = "";
		this.pendingListeners.clear();
		this.waitingForDrain = false;
		this.resetOutboundQueue();
	}

	private readDaemonPid(): number | null {
		return readPidFile(this.pidPath);
	}

	private async waitForPidExit(pid: number, timeoutMs: number): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (isPidAlive(pid) && Date.now() < deadline) {
			await new Promise<void>((r) => setTimeout(r, 50));
		}
	}

	// Tear down the connection to a stale daemon, kill it, and clear its files
	// so the next connect attempt spawns a fresh one. Only called for a daemon
	// with no live sessions, so no user work is lost. Files are removed only
	// once the process is confirmed dead — deleting the socket under a live
	// daemon would orphan it.
	private async killStaleDaemon(pid: number): Promise<void> {
		this.teardownSocket();
		try {
			process.kill(pid, "SIGTERM");
			await this.waitForPidExit(pid, 3_000);
			if (isPidAlive(pid)) {
				process.kill(pid, "SIGKILL");
				await this.waitForPidExit(pid, 1_000);
			}
		} catch {}
		if (isPidAlive(pid)) {
			console.warn(`[daemon-client] stale daemon pid ${pid} did not exit; leaving its files`);
			return;
		}
		removeFiles(this.pidPath, this.socketPath);
	}

	// A control send for this session failed permanently: surface it as a dead
	// session (onExit(-1)) instead of leaving a frozen tab with no signal.
	private failSession(id: string, context: string, err: unknown): void {
		console.error(`[daemon-client] ${context} for ${id} failed:`, err);
		const cb = this.callbacks.get(id);
		this.callbacks.delete(id);
		this.liveSessions.delete(id);
		cb?.onExit(-1);
	}

	disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.reconnecting = false;
		this.teardownSocket();
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

	get quitting(): boolean {
		return this.isQuitting;
	}

	detachAll(): void {
		try {
			if (this.remoteProtocolVersion < 2) {
				// v1 daemons have no "detach-all" handler; their per-session "detach"
				// already detaches this client from every session, which is exactly
				// the semantic wanted here.
				this.send({ type: "detach", id: "" });
			} else {
				this.send({ type: "detach-all" });
			}
		} catch {
			// Best effort — if the socket is already gone, there's nothing to detach from
		}
	}

	async create(
		id: string,
		cwd: string | undefined,
		onData: (data: string, meta?: TerminalDataMeta) => void,
		onExit: (code: number) => void,
		env?: Record<string, string>
	): Promise<void> {
		this.callbacks.set(id, { onData, onExit, cwd, env });
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
		onData: (data: string, meta?: TerminalDataMeta) => void,
		onExit: (code: number) => void,
		cwd?: string,
		env?: Record<string, string>
	): Promise<void> {
		this.callbacks.set(id, { onData, onExit, cwd, env });
		try {
			this.send({ type: "attach", id });
		} catch (err) {
			this.callbacks.delete(id);
			throw err;
		}
	}

	write(id: string, data: string): void {
		if (!this.isConnected) return;
		const frames = this.buildWriteFrames(id, data);
		const first = frames[0];
		if (frames.length === 1 && first) {
			this.dispatchFrame("write", id, first.encoded, first.bytes, true, undefined);
			return;
		}
		this.sendWriteGroup(id, frames);
	}

	// The daemon discards frames over MAX_FRAME_BYTES, so a large paste sent as
	// one write frame would silently vanish. Slice the data into frames that
	// each fit, encoding every frame exactly once.
	private buildWriteFrames(id: string, data: string): Array<{ encoded: string; bytes: number }> {
		const frames: Array<{ encoded: string; bytes: number }> = [];
		let pos = 0;
		while (pos < data.length) {
			// One UTF-16 unit encodes to at least one byte, so a frame can never
			// hold more chars than its byte budget — this caps the work per
			// measurement at one frame's worth regardless of paste size.
			let len = Math.min(data.length - pos, MAX_FRAME_BYTES);
			for (;;) {
				let end = pos + len;
				const boundary = data.charCodeAt(end - 1);
				if (boundary >= 0xd800 && boundary <= 0xdbff && len > 1) {
					end--; // keep surrogate pairs intact
					len--;
				}
				const encoded = `${JSON.stringify({ type: "write", id, data: data.slice(pos, end) })}\n`;
				const bytes = Buffer.byteLength(encoded, "utf-8");
				if (bytes <= MAX_FRAME_BYTES || len <= 1) {
					frames.push({ encoded, bytes });
					pos = end;
					break;
				}
				// Shrink proportionally toward the byte budget; escaping/multibyte
				// overhead is roughly uniform, so this converges in a step or two.
				len = Math.max(1, Math.floor((len * (MAX_FRAME_BYTES - 100)) / bytes));
			}
		}
		return frames;
	}

	// Deliver a multi-frame write all-or-nothing: a partially delivered paste
	// would hand the shell a spliced version of the input.
	private sendWriteGroup(id: string, frames: Array<{ encoded: string; bytes: number }>): void {
		if (!this.socket || this.socket.destroyed) return;

		if (this.waitingForDrain || this.outboundQueue.length > 0) {
			const totalBytes = frames.reduce((sum, f) => sum + f.bytes, 0);
			if (this.outboundQueuedBytes + totalBytes > MAX_OUTBOUND_QUEUE_BYTES) {
				console.warn(
					`[daemon-client] outbound queue full (${this.outboundQueuedBytes}/${MAX_OUTBOUND_QUEUE_BYTES}B); dropping chunked write whole (${frames.length} frames, ${totalBytes}B)`
				);
				return;
			}
			const groupId = ++this.writeGroupCounter;
			for (const f of frames) {
				this.enqueueOutbound("write", id, f.encoded, f.bytes, true, groupId);
			}
			return;
		}

		// Socket idle: write every chunk directly. Node buffers under transient
		// backpressure, so the group is delivered whole and in order; unrelated
		// later sends queue once waitingForDrain is set.
		for (const f of frames) {
			const ok = this.socket.write(f.encoded);
			if (!ok && !this.waitingForDrain) {
				this.waitingForDrain = true;
				console.warn("[daemon-client] socket backpressure detected");
			}
		}
	}

	resize(id: string, cols: number, rows: number): void {
		if (!this.isConnected) return;
		this.send({ type: "resize", id, cols, rows });
	}

	/** Detach from a PTY without killing it. The PTY keeps running in the daemon. */
	detach(id: string): void {
		this.callbacks.delete(id);
		// Keep id in liveSessions so re-attach works on next create call
		if (this.remoteProtocolVersion < 2) {
			// A v1 daemon executes a per-session detach as detach-client-from-ALL
			// sessions, silently freezing every other tab. Dropping the callbacks
			// above suffices: unmatched data frames are discarded on arrival.
			return;
		}
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
				this.teardownSocket();

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
		const encoded = `${JSON.stringify(msg)}\n`;
		const messageBytes = Buffer.byteLength(encoded, "utf-8");
		const droppable = msg.type === "write" || msg.type === "resize";
		this.dispatchFrame(
			msg.type,
			"id" in msg ? msg.id : undefined,
			encoded,
			messageBytes,
			droppable,
			undefined
		);
	}

	private dispatchFrame(
		type: ClientMessage["type"],
		id: string | undefined,
		encoded: string,
		messageBytes: number,
		droppable: boolean,
		groupId: number | undefined
	): void {
		if (!this.socket || this.socket.destroyed) {
			throw new Error("Daemon not connected");
		}

		// The daemon discards any inbound frame over MAX_FRAME_BYTES without a
		// reply, so an oversized frame can never be delivered. Control messages
		// (create/attach/dispose/...) must never vanish silently — a dropped
		// create leaves a permanently blank terminal tab.
		if (messageBytes > MAX_FRAME_BYTES) {
			if (!droppable) {
				throw new Error(
					`Outbound ${type} frame (${messageBytes}B) exceeds daemon frame limit ${MAX_FRAME_BYTES}B`
				);
			}
			console.warn(
				`[daemon-client] outbound ${type} frame ${messageBytes}B exceeds daemon frame limit ${MAX_FRAME_BYTES}B; dropping message`
			);
			return;
		}

		if (this.waitingForDrain || this.outboundQueue.length > 0) {
			this.enqueueOutbound(type, id, encoded, messageBytes, droppable, groupId);
			return;
		}

		const ok = this.socket.write(encoded);
		if (!ok) {
			this.waitingForDrain = true;
			console.warn("[daemon-client] socket backpressure detected");
		}
	}

	private setupMessageHandler(): void {
		const socket = this.socket;
		if (!socket) return;

		// Per-socket decoder: a multibyte character split across two chunks must
		// not decode to U+FFFD on either side of the boundary.
		const decoder = new StringDecoder("utf8");
		socket.on("data", (chunk) => {
			this.lineBuffer += decoder.write(chunk);
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
			// Complete lines are parsed above, so anything left is one partial
			// frame. The largest legitimate daemon frame is a full-scrollback
			// replay; anything bigger is garbage that would otherwise grow forever.
			if (this.lineBuffer.length > MAX_INBOUND_BUFFER_CHARS) {
				console.warn("[daemon-client] inbound frame exceeds buffer cap, discarding");
				this.lineBuffer = "";
			}
		});

		socket.on("drain", () => {
			if (this.socket !== socket) return;
			this.flushOutboundQueue();
		});

		socket.on("close", () => {
			// An intentional teardown (disconnect, reconnect, stale-daemon restart)
			// replaces or nulls this.socket before destroying it, and resets state
			// itself. Reconnecting here would tear down the replacement connection.
			if (this.socket !== socket) return;
			console.warn("[daemon-client] connection to daemon lost");
			this.socket = null;
			this.waitingForDrain = false;
			this.resetOutboundQueue();
			this.onConnectionStatusChange?.(false);
			this.attemptReconnect();
		});

		socket.on("error", (err) => {
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
					cb.onData(
						Buffer.from(msg.data, "base64").toString("utf-8"),
						msg.replay ? { replay: true, fg: msg.fg || undefined } : undefined
					);
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
					try {
						this.send({ type: "create", id: msg.id, cwd: stored?.cwd, env: stored?.env });
					} catch (err) {
						this.failSession(msg.id, "fallback create", err);
					}
				} else if (this.callbacks.has(msg.id)) {
					// Any other daemon-reported error (create failure, duplicate id, ...)
					// means the session is not running. Surface it as an exit instead of
					// leaving a tab that never receives data or an exit signal.
					this.failSession(msg.id, "daemon error", msg.message);
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
		const existingPid = this.readDaemonPid();
		if (existingPid) {
			if (isPidAlive(existingPid)) {
				return; // process exists, let waitForSocket handle the rest
			}
			// process is gone, clean up stale file
			removeFiles(this.pidPath);
		}

		// Remove stale socket so waitForSocket blocks until the new daemon creates one
		removeFiles(this.socketPath);

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

	private enqueueOutbound(
		type: ClientMessage["type"],
		id: string | undefined,
		encoded: string,
		messageBytes: number,
		droppable: boolean,
		groupId: number | undefined
	): void {
		if (type === "resize") {
			for (let i = 0; i < this.outboundQueue.length; i++) {
				const queued = this.outboundQueue[i];
				if (queued?.type === "resize" && queued.id === id) {
					this.outboundQueuedBytes -= queued.bytes;
					this.outboundQueue.splice(i, 1);
					break;
				}
			}
		}

		if (!droppable) {
			this.evictDroppableForControl(messageBytes);
		}

		if (this.outboundQueuedBytes + messageBytes > MAX_OUTBOUND_QUEUE_BYTES) {
			if (droppable) {
				console.warn(
					`[daemon-client] outbound queue full (${this.outboundQueuedBytes}/${MAX_OUTBOUND_QUEUE_BYTES}B); dropping message`
				);
				return;
			}
			// Control frames must never vanish silently, but queuing past the
			// budget would grow without bound while the daemon is not reading.
			// Reject so the caller rolls back and surfaces the failure.
			throw new Error(
				`Daemon outbound queue full (${this.outboundQueuedBytes}/${MAX_OUTBOUND_QUEUE_BYTES}B); cannot send ${type}`
			);
		}

		this.outboundQueue.push({ encoded, bytes: messageBytes, droppable, type, id, groupId });
		this.outboundQueuedBytes += messageBytes;
	}

	private evictDroppableForControl(controlBytes: number): void {
		while (this.outboundQueuedBytes + controlBytes > MAX_OUTBOUND_QUEUE_BYTES) {
			const dropIndex = this.outboundQueue.findIndex((entry) => entry.droppable);
			if (dropIndex === -1) {
				break;
			}
			const dropped = this.outboundQueue.splice(dropIndex, 1)[0];
			if (!dropped) {
				break;
			}
			this.outboundQueuedBytes -= dropped.bytes;
			let evicted = 1;
			// Chunked writes are all-or-nothing: evicting one chunk must take the
			// whole group with it, or the shell receives a spliced paste.
			if (dropped.groupId !== undefined) {
				for (let i = this.outboundQueue.length - 1; i >= 0; i--) {
					const entry = this.outboundQueue[i];
					if (entry?.groupId === dropped.groupId) {
						this.outboundQueuedBytes -= entry.bytes;
						this.outboundQueue.splice(i, 1);
						evicted++;
					}
				}
			}
			console.warn(
				`[daemon-client] outbound queue full (${this.outboundQueuedBytes}/${MAX_OUTBOUND_QUEUE_BYTES}B); dropping ${evicted > 1 ? `${evicted} chunked ${dropped.type} frames` : dropped.type} to prioritize control message`
			);
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
