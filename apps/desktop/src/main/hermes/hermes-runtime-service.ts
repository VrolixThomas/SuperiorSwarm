import type {
	HermesCatalog,
	HermesReconnectBindingMetadata,
	HermesRuntimeEvent,
	HermesRuntimeState,
	HermesSessionBinding,
	HermesSessionHistory,
	HermesSessionSummary,
} from "../../shared/hermes";
import { getHermesConnectionWithToken, markHermesConnectionConnected } from "./hermes-connections";
import {
	type extractWorkspaceArtifacts,
	normalizeHermesSessionBinding,
	sanitizeHermesPayload,
} from "./hermes-protocol";
import { HermesRestClient } from "./hermes-rest-client";
import {
	HermesRpcError,
	HermesRuntimeClient,
	type HermesRuntimeConnectionSettings,
} from "./hermes-runtime-client";
import { type HermesTokenVault, hermesTokenVault } from "./hermes-token-vault";
import { linkHermesWorkspaceArtifacts } from "./hermes-workspace-links";

export interface HermesRuntimeClientLike {
	connect(settings: HermesRuntimeConnectionSettings): Promise<void>;
	disconnect(): void;
	request(
		method: string,
		params: Record<string, unknown>,
		options?: { signal?: AbortSignal; timeoutMs?: number }
	): Promise<unknown>;
	getState(): HermesRuntimeState;
	subscribe(listener: (event: HermesRuntimeEvent) => void): () => void;
	subscribeState(listener: (state: HermesRuntimeState) => void): () => void;
}

export interface HermesRestClientLike {
	listSessions(signal?: AbortSignal): Promise<HermesSessionSummary[]>;
	getTranscript(
		durableSessionId: string,
		profileId?: string,
		signal?: AbortSignal
	): Promise<HermesSessionHistory>;
}

interface BufferedEvent {
	seq: number;
	event: HermesRuntimeEvent;
}

interface RuntimeBinding extends HermesSessionBinding {
	activeTurn: boolean;
}

interface ConnectionRuntime {
	client: HermesRuntimeClientLike;
	rest: HermesRestClientLike;
	profileId: string;
	connectionMode: "loopback" | "remote";
	catalog: HermesCatalog;
	bindings: Map<string, RuntimeBinding>;
	runtimeToDurable: Map<string, string>;
	aliases: Map<string, string>;
	events: BufferedEvent[];
	nextSeq: number;
	unsubscribers: Array<() => void>;
	reconnectTask: Promise<void> | null;
	histories: Map<string, HermesSessionHistory>;
}

export interface HermesRuntimeServiceOptions {
	clientFactory?: () => HermesRuntimeClientLike;
	restClientFactory?: (settings: {
		baseUrl: string;
		profileId: string;
		token: string;
	}) => HermesRestClientLike;
	tokenVault?: HermesTokenVault;
}

const MAX_BUFFERED_EVENTS = 1_000;

function stockCatalog(
	sessions: HermesSessionSummary[],
	connectionMode: "loopback" | "remote"
): HermesCatalog {
	return {
		compatibility: {
			state: "compatible",
			authMode: "token",
			canBrowse: true,
			canChat: true,
			canReport: false,
			limitations:
				connectionMode === "remote"
					? ["Slack reporting requires a sender configured for this remote profile"]
					: ["Slack reporting is available only for validated threaded origins"],
		},
		sessions,
	};
}

export class HermesRuntimeService {
	private readonly runtimes = new Map<string, ConnectionRuntime>();
	private readonly clientFactory: () => HermesRuntimeClientLike;
	private readonly restClientFactory: NonNullable<HermesRuntimeServiceOptions["restClientFactory"]>;
	private readonly tokenVault: HermesTokenVault;

	constructor(options: HermesRuntimeServiceOptions = {}) {
		this.clientFactory = options.clientFactory ?? (() => new HermesRuntimeClient());
		this.restClientFactory =
			options.restClientFactory ?? ((settings) => new HermesRestClient(settings));
		this.tokenVault = options.tokenVault ?? hermesTokenVault;
	}

	async connect(connectionId: string): Promise<HermesCatalog> {
		const connection = getHermesConnectionWithToken(connectionId, this.tokenVault);
		if (!connection) {
			throw new Error("Hermes token is unavailable; enter it again to reconnect");
		}
		this.disconnect(connectionId);
		const client = this.clientFactory();
		const rest = this.restClientFactory({
			baseUrl: connection.baseUrl,
			profileId: connection.profileId,
			token: connection.token,
		});
		const runtime: ConnectionRuntime = {
			client,
			rest,
			profileId: connection.profileId,
			connectionMode: connection.connectionMode,
			catalog: stockCatalog([], connection.connectionMode),
			bindings: new Map(),
			runtimeToDurable: new Map(),
			aliases: new Map(),
			events: [],
			nextSeq: 0,
			unsubscribers: [],
			reconnectTask: null,
			histories: new Map(),
		};
		this.runtimes.set(connectionId, runtime);
		this.bindClient(connectionId, runtime);
		try {
			await client.connect({
				baseUrl: connection.baseUrl,
				authMode: "token",
				token: connection.token,
			});
			const sessions = await rest.listSessions();
			runtime.catalog = stockCatalog(sessions, connection.connectionMode);
			markHermesConnectionConnected(connectionId);
			return runtime.catalog;
		} catch (error) {
			this.disconnect(connectionId);
			throw error;
		}
	}

	disconnect(connectionId: string): void {
		const runtime = this.runtimes.get(connectionId);
		if (!runtime) return;
		for (const unsubscribe of runtime.unsubscribers) unsubscribe();
		runtime.client.disconnect();
		this.runtimes.delete(connectionId);
	}

	getState(connectionId: string): HermesRuntimeState {
		return (
			this.runtimes.get(connectionId)?.client.getState() ?? {
				status: "disconnected",
				reconnectAttempt: 0,
				lastConnectedAt: null,
				error: null,
			}
		);
	}

	async catalog(connectionId: string): Promise<HermesCatalog> {
		const runtime = this.requireRuntime(connectionId);
		const sessions = await runtime.rest.listSessions();
		runtime.catalog = stockCatalog(sessions, runtime.connectionMode);
		return runtime.catalog;
	}

	async history(connectionId: string, hermesSessionId: string): Promise<HermesSessionHistory> {
		const runtime = this.requireRuntime(connectionId);
		const durableSessionId = this.resolveDurableId(runtime, hermesSessionId);
		const profileId = this.profileFor(runtime, durableSessionId);
		const history = await runtime.rest.getTranscript(durableSessionId, profileId);
		if (history.durableSessionId !== durableSessionId) {
			runtime.aliases.set(hermesSessionId, history.durableSessionId);
			runtime.aliases.set(durableSessionId, history.durableSessionId);
		}
		runtime.histories.set(hermesSessionId, history);
		this.linkArtifacts(
			connectionId,
			history.durableSessionId,
			history.messages.flatMap((message) => message.workspaceArtifacts)
		);
		return history;
	}

	async create(
		connectionId: string,
		input: { cwd?: string; profileId?: string } = {}
	): Promise<HermesSessionBinding> {
		const runtime = this.requireRuntime(connectionId);
		const profileId = input.profileId ?? runtime.profileId;
		const params: Record<string, unknown> = { source: "superiorswarm", profile: profileId };
		if (input.cwd) params["cwd"] = input.cwd;
		const binding = normalizeHermesSessionBinding(
			await runtime.client.request("session.create", params),
			undefined,
			profileId
		);
		this.installBinding(runtime, binding);
		return binding;
	}

	async resume(
		connectionId: string,
		hermesSessionId: string
	): Promise<HermesSessionBinding & { history: HermesSessionHistory }> {
		const runtime = this.requireRuntime(connectionId);
		if (runtime.reconnectTask) await runtime.reconnectTask;
		const history = await this.history(connectionId, hermesSessionId);
		const durableSessionId = history.durableSessionId;
		const existing =
			runtime.bindings.get(durableSessionId) ?? runtime.bindings.get(hermesSessionId);
		if (existing) {
			try {
				const activated = normalizeHermesSessionBinding(
					await runtime.client.request("session.activate", {
						session_id: existing.runtimeSessionId,
						omit_messages: true,
					}),
					durableSessionId,
					existing.profileId
				);
				this.installBinding(runtime, activated);
				return { ...activated, history };
			} catch {
				this.removeBinding(runtime, existing);
			}
		}
		const binding = await this.resumeBinding(
			runtime,
			durableSessionId,
			this.profileFor(runtime, durableSessionId)
		);
		return { ...binding, history };
	}

	async submit(connectionId: string, hermesSessionId: string, text: string): Promise<{ ok: true }> {
		const runtime = this.requireRuntime(connectionId);
		let binding = this.bindingFor(runtime, hermesSessionId);
		if (!binding) binding = await this.resume(connectionId, hermesSessionId);
		if (binding.activeTurn) throw new Error("A Hermes turn is already active for this session");
		binding.activeTurn = true;
		try {
			await runtime.client.request("prompt.submit", {
				session_id: binding.runtimeSessionId,
				text,
			});
			return { ok: true };
		} catch (error) {
			binding.activeTurn = false;
			throw error;
		}
	}

	async interrupt(connectionId: string, hermesSessionId: string): Promise<{ ok: true }> {
		const runtime = this.requireRuntime(connectionId);
		const binding = this.requireBinding(runtime, hermesSessionId);
		await runtime.client.request("session.interrupt", {
			session_id: binding.runtimeSessionId,
		});
		binding.activeTurn = false;
		return { ok: true };
	}

	async respondToApproval(input: {
		connectionId: string;
		hermesSessionId: string;
		requestId: string;
		choice: string;
	}): Promise<{ ok: true }> {
		const runtime = this.requireRuntime(input.connectionId);
		const binding = this.requireBinding(runtime, input.hermesSessionId);
		await runtime.client.request("approval.respond", {
			session_id: binding.runtimeSessionId,
			request_id: input.requestId,
			choice: input.choice,
		});
		return { ok: true };
	}

	async respondToClarification(input: {
		connectionId: string;
		hermesSessionId: string;
		requestId: string;
		answer: string;
	}): Promise<{ ok: true }> {
		const runtime = this.requireRuntime(input.connectionId);
		const binding = this.requireBinding(runtime, input.hermesSessionId);
		await runtime.client.request("clarify.respond", {
			session_id: binding.runtimeSessionId,
			request_id: input.requestId,
			answer: input.answer,
		});
		return { ok: true };
	}

	events(connectionId: string, afterSeq: number): { events: BufferedEvent[]; nextSeq: number } {
		const runtime = this.runtimes.get(connectionId);
		if (!runtime) return { events: [], nextSeq: afterSeq };
		return {
			events: runtime.events.filter((event) => event.seq > afterSeq),
			nextSeq: runtime.nextSeq,
		};
	}

	shutdown(): void {
		for (const connectionId of [...this.runtimes.keys()]) this.disconnect(connectionId);
	}

	private bindClient(connectionId: string, runtime: ConnectionRuntime): void {
		runtime.unsubscribers.push(
			runtime.client.subscribe((event) => {
				if (event.type === "runtime.history-refresh-required") {
					this.reconcileAfterReconnect(connectionId, runtime);
					return;
				}
				const durableSessionId = event.runtimeSessionId
					? (runtime.runtimeToDurable.get(event.runtimeSessionId) ?? null)
					: null;
				const mappedEvent = { ...event, durableSessionId };
				this.pushEvent(connectionId, mappedEvent);
				if (!durableSessionId) return;
				if (event.workspaceArtifacts.length > 0) {
					this.linkArtifacts(connectionId, durableSessionId, event.workspaceArtifacts);
				}
				if (this.isTerminalEvent(event)) {
					const binding = this.bindingFor(runtime, durableSessionId);
					if (binding) binding.activeTurn = false;
					void this.refreshAfterTerminal(connectionId, runtime, durableSessionId);
				}
			}),
			runtime.client.subscribeState((state) => {
				const sanitized = sanitizeHermesPayload(state.error);
				this.pushEvent(connectionId, {
					type: "runtime.connection",
					runtimeSessionId: null,
					durableSessionId: null,
					turnId: null,
					requestId: null,
					text: typeof sanitized === "string" ? sanitized : null,
					toolName: null,
					status: state.status,
					payload: {},
					workspaceArtifacts: [],
					receivedAt: Date.now(),
				});
			})
		);
	}

	private reconcileAfterReconnect(connectionId: string, runtime: ConnectionRuntime): void {
		if (runtime.reconnectTask || this.runtimes.get(connectionId) !== runtime) return;
		const task = this.reacquireBindings(connectionId, runtime);
		runtime.reconnectTask = task;
		const clear = () => {
			if (runtime.reconnectTask === task) runtime.reconnectTask = null;
		};
		void task.then(clear, clear);
	}

	private async reacquireBindings(connectionId: string, runtime: ConnectionRuntime): Promise<void> {
		const durableIds = [
			...new Set([...runtime.bindings.values()].map((binding) => binding.durableSessionId)),
		];
		runtime.bindings.clear();
		runtime.runtimeToDurable.clear();
		const bindings: HermesReconnectBindingMetadata[] = [];
		const failedSessionIds: string[] = [];
		for (const durableSessionId of durableIds) {
			try {
				await this.history(connectionId, durableSessionId);
				const binding = await this.resumeBinding(
					runtime,
					this.resolveDurableId(runtime, durableSessionId),
					this.profileFor(runtime, durableSessionId)
				);
				bindings.push({
					hermesSessionId: durableSessionId,
					durableSessionId: binding.durableSessionId,
					runtimeSessionId: binding.runtimeSessionId,
				});
			} catch (error) {
				failedSessionIds.push(durableSessionId);
				this.pushRuntimeError(connectionId, error);
			}
		}
		this.pushEvent(connectionId, {
			type: "runtime.history-refresh-required",
			runtimeSessionId: null,
			durableSessionId: null,
			turnId: null,
			requestId: null,
			text: null,
			toolName: null,
			status: failedSessionIds.length === 0 ? "reconnected" : "recoverable-error",
			payload: { bindings, failedSessionIds },
			workspaceArtifacts: [],
			receivedAt: Date.now(),
		});
	}

	private async resumeBinding(
		runtime: ConnectionRuntime,
		durableSessionId: string,
		profileId: string
	): Promise<RuntimeBinding> {
		const binding = normalizeHermesSessionBinding(
			await runtime.client.request("session.resume", {
				session_id: durableSessionId,
				profile: profileId,
				source: "superiorswarm",
				omit_messages: true,
			}),
			durableSessionId,
			profileId
		);
		return this.installBinding(runtime, binding);
	}

	private installBinding(
		runtime: ConnectionRuntime,
		binding: HermesSessionBinding
	): RuntimeBinding {
		const previous = runtime.bindings.get(binding.durableSessionId);
		if (previous) runtime.runtimeToDurable.delete(previous.runtimeSessionId);
		const installed: RuntimeBinding = {
			...binding,
			activeTurn: previous?.activeTurn ?? false,
		};
		runtime.bindings.set(binding.durableSessionId, installed);
		runtime.runtimeToDurable.set(binding.runtimeSessionId, binding.durableSessionId);
		return installed;
	}

	private removeBinding(runtime: ConnectionRuntime, binding: RuntimeBinding): void {
		runtime.bindings.delete(binding.durableSessionId);
		runtime.runtimeToDurable.delete(binding.runtimeSessionId);
	}

	private bindingFor(runtime: ConnectionRuntime, hermesSessionId: string): RuntimeBinding | null {
		const durableSessionId = this.resolveDurableId(runtime, hermesSessionId);
		return runtime.bindings.get(durableSessionId) ?? runtime.bindings.get(hermesSessionId) ?? null;
	}

	private requireBinding(runtime: ConnectionRuntime, hermesSessionId: string): RuntimeBinding {
		const binding = this.bindingFor(runtime, hermesSessionId);
		if (!binding) throw new Error("Resume the Hermes session before using live controls");
		return binding;
	}

	private resolveDurableId(runtime: ConnectionRuntime, hermesSessionId: string): string {
		return runtime.aliases.get(hermesSessionId) ?? hermesSessionId;
	}

	private profileFor(runtime: ConnectionRuntime, durableSessionId: string): string {
		return (
			runtime.catalog.sessions.find(
				(session) =>
					session.id === durableSessionId || runtime.aliases.get(session.id) === durableSessionId
			)?.profileId ?? runtime.profileId
		);
	}

	private async refreshAfterTerminal(
		connectionId: string,
		runtime: ConnectionRuntime,
		durableSessionId: string
	): Promise<void> {
		try {
			await this.history(connectionId, durableSessionId);
			if (this.runtimes.get(connectionId) !== runtime) return;
			this.pushEvent(connectionId, {
				type: "runtime.history-refresh-required",
				runtimeSessionId: null,
				durableSessionId,
				turnId: null,
				requestId: null,
				text: null,
				toolName: null,
				status: "canonical-refreshed",
				payload: {},
				workspaceArtifacts: [],
				receivedAt: Date.now(),
			});
		} catch (error) {
			this.pushRuntimeError(connectionId, error);
		}
	}

	private isTerminalEvent(event: HermesRuntimeEvent): boolean {
		return (
			event.type === "message.complete" ||
			event.type === "turn.complete" ||
			event.type === "turn.completed" ||
			event.type === "turn.failed" ||
			event.type === "turn.cancelled" ||
			event.type === "error"
		);
	}

	private linkArtifacts(
		connectionId: string,
		hermesSessionId: string,
		artifacts: ReturnType<typeof extractWorkspaceArtifacts>
	): void {
		if (artifacts.length === 0) return;
		linkHermesWorkspaceArtifacts({
			connectionId,
			hermesSessionId,
			hermesLineageRootId: null,
			artifacts,
		});
	}

	private pushEvent(connectionId: string, event: HermesRuntimeEvent): void {
		const runtime = this.runtimes.get(connectionId);
		if (!runtime) return;
		runtime.nextSeq++;
		runtime.events.push({ seq: runtime.nextSeq, event });
		if (runtime.events.length > MAX_BUFFERED_EVENTS) runtime.events.shift();
	}

	private pushRuntimeError(connectionId: string, error: unknown): void {
		const sanitized = sanitizeHermesPayload(
			error instanceof Error ? error.message : "Hermes runtime error"
		);
		this.pushEvent(connectionId, {
			type: "runtime.error",
			runtimeSessionId: null,
			durableSessionId: null,
			turnId: null,
			requestId: null,
			text: typeof sanitized === "string" ? sanitized : "Hermes runtime error",
			toolName: null,
			status: "error",
			payload: {},
			workspaceArtifacts: [],
			receivedAt: Date.now(),
		});
	}

	private requireRuntime(connectionId: string): ConnectionRuntime {
		const runtime = this.runtimes.get(connectionId);
		if (!runtime) throw new Error("Hermes is disconnected");
		return runtime;
	}
}

export const hermesRuntimeService = new HermesRuntimeService();

// Keep the error type reachable for callers that distinguish stock busy/queued responses.
export { HermesRpcError };
