import type { HermesRuntimeEvent, HermesRuntimeState } from "../../shared/hermes";
import { normalizeHermesEvent, sanitizeHermesPayload } from "./hermes-protocol";

interface SocketEvent {
	data?: unknown;
}

export interface HermesSocket {
	readonly readyState: number;
	addEventListener(type: string, listener: (event: SocketEvent) => void): void;
	removeEventListener(type: string, listener: (event: SocketEvent) => void): void;
	send(data: string): void;
	close(code?: number, reason?: string): void;
}

export interface HermesRuntimeClientOptions {
	socketFactory?: (url: string) => HermesSocket;
	reconnect?: boolean;
	requestTimeoutMs?: number;
	reconnectBaseMs?: number;
	reconnectMaxMs?: number;
}

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
	removeAbortListener: () => void;
}

interface ConnectionSettings {
	baseUrl: string;
	token: string;
}

export class HermesRpcError extends Error {
	constructor(
		message: string,
		readonly code: number | string | null,
		readonly retryable: boolean
	) {
		super(message);
		this.name = "HermesRpcError";
	}
}

export function buildHermesWebSocketUrl(baseUrl: string, token: string): string {
	const url = new URL(baseUrl);
	if (url.protocol === "http:") url.protocol = "ws:";
	else if (url.protocol === "https:") url.protocol = "wss:";
	else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
		throw new Error("Hermes URL must use http, https, ws, or wss");
	}
	url.username = "";
	url.password = "";
	if (!url.pathname || url.pathname === "/") url.pathname = "/api/ws";
	url.search = "";
	url.searchParams.set("token", token);
	return url.toString();
}

function defaultSocketFactory(url: string): HermesSocket {
	return new WebSocket(url) as unknown as HermesSocket;
}

function safeErrorMessage(value: unknown): string {
	const message =
		value instanceof Error ? value.message : String(value || "Hermes connection failed");
	const sanitized = sanitizeHermesPayload(message);
	return typeof sanitized === "string" ? sanitized : "Hermes connection failed";
}

export class HermesRuntimeClient {
	private readonly socketFactory: (url: string) => HermesSocket;
	private readonly shouldReconnect: boolean;
	private readonly requestTimeoutMs: number;
	private readonly reconnectBaseMs: number;
	private readonly reconnectMaxMs: number;
	private socket: HermesSocket | null = null;
	private settings: ConnectionSettings | null = null;
	private pending = new Map<string, PendingRequest>();
	private subscribers = new Set<(event: HermesRuntimeEvent) => void>();
	private stateSubscribers = new Set<(state: HermesRuntimeState) => void>();
	private nextRequestId = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private manuallyDisconnected = true;
	private state: HermesRuntimeState = {
		status: "disconnected",
		reconnectAttempt: 0,
		lastConnectedAt: null,
		error: null,
	};

	constructor(options: HermesRuntimeClientOptions = {}) {
		this.socketFactory = options.socketFactory ?? defaultSocketFactory;
		this.shouldReconnect = options.reconnect ?? true;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
		this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
		this.reconnectMaxMs = options.reconnectMaxMs ?? 15_000;
	}

	getState(): HermesRuntimeState {
		return { ...this.state };
	}

	getPendingRequestCount(): number {
		return this.pending.size;
	}

	subscribe(listener: (event: HermesRuntimeEvent) => void): () => void {
		this.subscribers.add(listener);
		return () => this.subscribers.delete(listener);
	}

	subscribeState(listener: (state: HermesRuntimeState) => void): () => void {
		this.stateSubscribers.add(listener);
		return () => this.stateSubscribers.delete(listener);
	}

	async connect(settings: ConnectionSettings): Promise<void> {
		const previous = this.socket;
		this.socket = null;
		if (previous && previous.readyState < 2) previous.close(1000, "connection replaced");
		this.rejectPending(new Error("Hermes connection replaced"));
		this.settings = settings;
		this.manuallyDisconnected = false;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		try {
			await this.open(false);
		} catch (error) {
			this.closeCurrentSocket("connection failed");
			const message = safeErrorMessage(error);
			this.setState({ status: "error", error: message });
			throw new Error(message);
		}
	}

	disconnect(): void {
		this.manuallyDisconnected = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		const socket = this.socket;
		this.socket = null;
		if (socket && socket.readyState < 2) socket.close(1000, "client disconnect");
		this.rejectPending(new Error("Hermes disconnected"));
		this.setState({ status: "disconnected", reconnectAttempt: 0, error: null });
	}

	async request(
		method: string,
		params: Record<string, unknown>,
		options: { signal?: AbortSignal; timeoutMs?: number } = {}
	): Promise<unknown> {
		const socket = this.socket;
		if (!socket || socket.readyState !== 1) throw new Error("Hermes is disconnected");
		const id = `superiorswarm-${++this.nextRequestId}`;
		return new Promise((resolve, reject) => {
			const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Hermes request timed out: ${method}`));
			}, timeoutMs);
			const onAbort = () => {
				const pending = this.pending.get(id);
				if (!pending) return;
				clearTimeout(pending.timer);
				this.pending.delete(id);
				reject(new Error(`Hermes request cancelled: ${method}`));
			};
			options.signal?.addEventListener("abort", onAbort, { once: true });
			this.pending.set(id, {
				resolve,
				reject,
				timer,
				removeAbortListener: () => options.signal?.removeEventListener("abort", onAbort),
			});
			try {
				socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
			} catch (error) {
				clearTimeout(timer);
				this.pending.delete(id);
				options.signal?.removeEventListener("abort", onAbort);
				reject(new Error(safeErrorMessage(error)));
			}
		});
	}

	private async open(reconnecting: boolean): Promise<void> {
		const settings = this.settings;
		if (!settings) throw new Error("Hermes connection settings are missing");
		this.setState({
			status: reconnecting ? "reconnecting" : "connecting",
			error: null,
		});

		const socket = this.socketFactory(buildHermesWebSocketUrl(settings.baseUrl, settings.token));
		this.socket = socket;
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				if (error) reject(error);
				else resolve();
			};
			const onOpen = () => {
				if (this.socket !== socket) return;
				this.setState({
					status: "connected",
					reconnectAttempt: 0,
					lastConnectedAt: Date.now(),
					error: null,
				});
				if (reconnecting) {
					this.emit({
						type: "runtime.history-refresh-required",
						sessionId: null,
						turnId: null,
						requestId: null,
						text: null,
						toolName: null,
						status: "reconnected",
						payload: {},
						workspaceArtifacts: [],
						receivedAt: Date.now(),
					});
				}
				finish();
			};
			const onError = () => {
				if (this.socket === socket) finish(new Error("Hermes WebSocket connection failed"));
			};
			const onMessage = (event: SocketEvent) => {
				if (this.socket === socket) this.handleMessage(event.data);
			};
			const onClose = () => {
				if (this.socket !== socket) return;
				this.socket = null;
				this.rejectPending(new Error("Hermes connection closed"));
				if (!settled) finish(new Error("Hermes WebSocket closed before connecting"));
				this.handleClose();
			};
			socket.addEventListener("open", onOpen);
			socket.addEventListener("error", onError);
			socket.addEventListener("message", onMessage);
			socket.addEventListener("close", onClose);
		});
	}

	private handleMessage(raw: unknown): void {
		const text = typeof raw === "string" ? raw : raw instanceof Buffer ? raw.toString() : "";
		for (const line of text.split("\n").filter(Boolean)) {
			let value: unknown;
			try {
				value = JSON.parse(line);
			} catch {
				continue;
			}
			const event = normalizeHermesEvent(value);
			if (event) {
				this.emit(event);
				continue;
			}
			if (!value || typeof value !== "object") continue;
			const response = value as Record<string, unknown>;
			const id = typeof response["id"] === "string" ? response["id"] : null;
			if (!id) continue;
			const pending = this.pending.get(id);
			if (!pending) continue;
			this.pending.delete(id);
			clearTimeout(pending.timer);
			pending.removeAbortListener();
			const error = response["error"] as Record<string, unknown> | undefined;
			if (error) {
				const errorData =
					error["data"] !== null && typeof error["data"] === "object"
						? (error["data"] as Record<string, unknown>)
						: null;
				pending.reject(
					new HermesRpcError(
						safeErrorMessage(error["message"]),
						typeof error["code"] === "number" || typeof error["code"] === "string"
							? error["code"]
							: null,
						error["retryable"] === true || errorData?.["retryable"] === true
					)
				);
			} else {
				pending.resolve(response["result"]);
			}
		}
	}

	private handleClose(): void {
		if (this.manuallyDisconnected || !this.shouldReconnect || !this.settings) {
			this.setState({ status: "disconnected", error: null });
			return;
		}
		const attempt = this.state.reconnectAttempt + 1;
		this.setState({ status: "reconnecting", reconnectAttempt: attempt, error: null });
		const delay = Math.min(this.reconnectBaseMs * 2 ** (attempt - 1), this.reconnectMaxMs);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.open(true).catch((error) => {
				this.setState({ error: safeErrorMessage(error) });
				this.handleClose();
			});
		}, delay);
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.removeAbortListener();
			pending.reject(error);
		}
		this.pending.clear();
	}

	private closeCurrentSocket(reason: string): void {
		const socket = this.socket;
		this.socket = null;
		if (socket && socket.readyState < 2) socket.close(1000, reason);
	}

	private emit(event: HermesRuntimeEvent): void {
		for (const subscriber of this.subscribers) subscriber(event);
	}

	private setState(patch: Partial<HermesRuntimeState>): void {
		this.state = { ...this.state, ...patch };
		for (const subscriber of this.stateSubscribers) subscriber(this.getState());
	}
}
