import { randomUUID } from "node:crypto";
import type {
	HermesCatalog,
	HermesCompatibility,
	HermesOriginInfo,
	HermesOriginReportState,
	HermesRuntimeEvent,
	HermesRuntimeState,
	HermesTranscriptMessage,
} from "../../shared/hermes";
import { getHermesConnectionWithToken, markHermesConnectionConnected } from "./hermes-connections";
import {
	beginHermesOriginReport,
	finishHermesOriginReport,
	listHermesOriginReports,
} from "./hermes-origin-reports";
import {
	HERMES_REQUIRED_CAPABILITIES,
	extractWorkspaceArtifacts,
	normalizeHermesCatalog,
	normalizeHermesHistory,
	sanitizeHermesPayload,
} from "./hermes-protocol";
import { HermesRpcError, HermesRuntimeClient } from "./hermes-runtime-client";
import { type HermesTokenVault, hermesTokenVault } from "./hermes-token-vault";
import { linkHermesWorkspaceArtifacts } from "./hermes-workspace-links";

export interface HermesRuntimeClientLike {
	connect(settings: { baseUrl: string; token: string }): Promise<void>;
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

interface RuntimeBinding {
	canonicalSessionId: string;
	runtimeSessionId: string;
	lineageRootId: string | null;
	claimId: string;
	renewTimer: ReturnType<typeof setInterval>;
}

interface BufferedEvent {
	seq: number;
	event: HermesRuntimeEvent;
}

interface ConnectionRuntime {
	client: HermesRuntimeClientLike;
	compatibility: HermesCompatibility | null;
	catalog: HermesCatalog | null;
	bindings: Map<string, RuntimeBinding>;
	runtimeToCanonical: Map<string, string>;
	events: BufferedEvent[];
	nextSeq: number;
	unsubscribers: Array<() => void>;
}

export interface HermesRuntimeServiceOptions {
	clientFactory?: () => HermesRuntimeClientLike;
	tokenVault?: HermesTokenVault;
	clientId?: string;
	claimTtlSeconds?: number;
}

const MAX_BUFFERED_EVENTS = 1_000;

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringValue(...values: unknown[]): string | null {
	return (
		values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null
	);
}

export class HermesRuntimeService {
	private readonly runtimes = new Map<string, ConnectionRuntime>();
	private readonly clientFactory: () => HermesRuntimeClientLike;
	private readonly tokenVault: HermesTokenVault;
	private readonly clientId: string;
	private readonly claimTtlSeconds: number;

	constructor(options: HermesRuntimeServiceOptions = {}) {
		this.clientFactory = options.clientFactory ?? (() => new HermesRuntimeClient());
		this.tokenVault = options.tokenVault ?? hermesTokenVault;
		this.clientId = options.clientId ?? `superiorswarm-${randomUUID()}`;
		this.claimTtlSeconds = options.claimTtlSeconds ?? 60;
	}

	async connect(connectionId: string): Promise<HermesCatalog> {
		const connection = getHermesConnectionWithToken(connectionId, this.tokenVault);
		if (!connection) {
			throw new Error("Hermes token is unavailable; enter it again to reconnect");
		}
		const previousRuntime = this.runtimes.get(connectionId);
		if (previousRuntime) {
			await Promise.all(
				[...previousRuntime.bindings.values()].map((binding) =>
					previousRuntime.client
						.request("session.release", { claim_id: binding.claimId }, { timeoutMs: 2_000 })
						.catch(() => undefined)
				)
			);
			this.disconnect(connectionId);
		}
		let runtime = this.runtimes.get(connectionId);
		if (!runtime) {
			const client = this.clientFactory();
			runtime = {
				client,
				compatibility: null,
				catalog: null,
				bindings: new Map(),
				runtimeToCanonical: new Map(),
				events: [],
				nextSeq: 0,
				unsubscribers: [],
			};
			this.bindClient(connectionId, runtime);
			this.runtimes.set(connectionId, runtime);
		}
		try {
			await runtime.client.connect({ baseUrl: connection.baseUrl, token: connection.token });
		} catch (error) {
			this.disconnect(connectionId);
			throw error;
		}
		let catalog: HermesCatalog;
		try {
			catalog = normalizeHermesCatalog(
				await runtime.client.request("session.catalog", { profile: connection.profileId })
			);
		} catch (error) {
			const methodMissing =
				error instanceof HermesRpcError &&
				(error.code === -32601 || String(error.code).toLowerCase().includes("method"));
			if (!methodMissing) {
				this.disconnect(connectionId);
				throw error;
			}
			catalog = {
				compatibility: {
					state: "upgrade-required",
					protocolVersion: null,
					capabilities: [],
					missingCapabilities: [...HERMES_REQUIRED_CAPABILITIES],
				},
				sessions: [],
			};
		}
		runtime.compatibility = catalog.compatibility;
		runtime.catalog = catalog;
		markHermesConnectionConnected(connectionId);
		return catalog;
	}

	disconnect(connectionId: string): void {
		const runtime = this.runtimes.get(connectionId);
		if (!runtime) return;
		for (const binding of runtime.bindings.values()) clearInterval(binding.renewTimer);
		for (const unsubscribe of runtime.unsubscribers) unsubscribe();
		runtime.client.disconnect();
		this.runtimes.delete(connectionId);
	}

	getState(connectionId: string): HermesRuntimeState {
		const runtime = this.runtimes.get(connectionId);
		if (!runtime) {
			return {
				status: "disconnected",
				reconnectAttempt: 0,
				lastConnectedAt: null,
				error: null,
			};
		}
		const state = runtime.client.getState();
		if (runtime.compatibility?.state === "upgrade-required") {
			return { ...state, status: "upgrade-required", error: "Hermes upgrade required" };
		}
		return state;
	}

	async catalog(connectionId: string): Promise<HermesCatalog> {
		const runtime = this.requireRuntime(connectionId);
		if (
			runtime.catalog &&
			runtime.compatibility?.state === "upgrade-required" &&
			runtime.compatibility.protocolVersion === null
		) {
			return runtime.catalog;
		}
		const connection = getHermesConnectionWithToken(connectionId, this.tokenVault);
		if (!connection) throw new Error("Hermes connection was not found");
		const catalog = normalizeHermesCatalog(
			await runtime.client.request("session.catalog", { profile: connection.profileId })
		);
		runtime.compatibility = catalog.compatibility;
		runtime.catalog = catalog;
		return catalog;
	}

	async resume(
		connectionId: string,
		hermesSessionId: string
	): Promise<{
		canonicalSessionId: string;
		runtimeSessionId: string;
		claimId: string;
		history: HermesTranscriptMessage[];
	}> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const existing = runtime.bindings.get(hermesSessionId);
		if (existing) {
			return {
				canonicalSessionId: hermesSessionId,
				runtimeSessionId: existing.runtimeSessionId,
				claimId: existing.claimId,
				history: await this.history(connectionId, hermesSessionId),
			};
		}
		const session = runtime.catalog?.sessions.find(
			(candidate) => candidate.id === hermesSessionId || candidate.lineageTipId === hermesSessionId
		);
		const canonicalSessionId = session?.lineageTipId ?? hermesSessionId;
		const claimResult = object(
			await runtime.client.request("session.claim", {
				session_id: canonicalSessionId,
				surface: "superiorswarm",
				client_id: this.clientId,
				ttl: this.claimTtlSeconds,
			})
		);
		const claimId = stringValue(claimResult["claim_id"], claimResult["claimId"]);
		if (!claimId) throw new Error("Hermes returned an invalid session claim");

		try {
			const resumed = object(
				await runtime.client.request("session.resume", {
					session_id: canonicalSessionId,
					source: "superiorswarm",
				})
			);
			const runtimeSessionId = stringValue(
				resumed["runtime_session_id"],
				resumed["session_id"],
				resumed["sessionId"]
			);
			if (!runtimeSessionId) throw new Error("Hermes returned an invalid resumed session");
			const resolvedCanonicalSessionId =
				stringValue(
					resumed["stored_session_id"],
					resumed["canonical_session_id"],
					resumed["lineage_tip_id"]
				) ?? canonicalSessionId;
			const renewTimer = setInterval(
				() => {
					void runtime.client
						.request("session.claim_renew", { claim_id: claimId })
						.catch((error) => this.pushRuntimeError(connectionId, error));
				},
				Math.max(5_000, (this.claimTtlSeconds * 1_000) / 2)
			);
			renewTimer.unref?.();
			const binding: RuntimeBinding = {
				canonicalSessionId: resolvedCanonicalSessionId,
				runtimeSessionId,
				lineageRootId: session?.lineageRootId ?? null,
				claimId,
				renewTimer,
			};
			runtime.bindings.set(hermesSessionId, binding);
			runtime.runtimeToCanonical.set(runtimeSessionId, hermesSessionId);
			const history = await this.history(connectionId, hermesSessionId);
			await this.backfillToolArtifacts(connectionId, hermesSessionId).catch((error) =>
				this.pushRuntimeError(connectionId, error)
			);
			return {
				canonicalSessionId: resolvedCanonicalSessionId,
				runtimeSessionId,
				claimId,
				history,
			};
		} catch (error) {
			const failedBinding = runtime.bindings.get(hermesSessionId);
			if (failedBinding?.claimId === claimId) {
				clearInterval(failedBinding.renewTimer);
				runtime.bindings.delete(hermesSessionId);
				runtime.runtimeToCanonical.delete(failedBinding.runtimeSessionId);
			}
			await runtime.client.request("session.release", { claim_id: claimId }).catch(() => undefined);
			throw error;
		}
	}

	async history(connectionId: string, hermesSessionId: string): Promise<HermesTranscriptMessage[]> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const binding = this.requireBinding(runtime, hermesSessionId);
		const history = normalizeHermesHistory(
			await runtime.client.request("session.history", { session_id: binding.runtimeSessionId })
		);
		this.linkArtifacts(
			connectionId,
			hermesSessionId,
			binding.lineageRootId,
			history.flatMap((message) => message.workspaceArtifacts)
		);
		return history;
	}

	async submit(connectionId: string, hermesSessionId: string, text: string): Promise<unknown> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const binding = this.requireBinding(runtime, hermesSessionId);
		return runtime.client.request("prompt.submit", {
			session_id: binding.runtimeSessionId,
			text,
		});
	}

	async interrupt(connectionId: string, hermesSessionId: string): Promise<unknown> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const binding = this.requireBinding(runtime, hermesSessionId);
		return runtime.client.request("session.interrupt", { session_id: binding.runtimeSessionId });
	}

	async respondToApproval(input: {
		connectionId: string;
		hermesSessionId: string;
		requestId: string;
		choice: string;
	}): Promise<unknown> {
		const runtime = this.requireCompatibleRuntime(input.connectionId);
		const binding = this.requireBinding(runtime, input.hermesSessionId);
		return runtime.client.request("approval.respond", {
			session_id: binding.runtimeSessionId,
			request_id: input.requestId,
			choice: input.choice,
		});
	}

	async respondToClarification(input: {
		connectionId: string;
		hermesSessionId: string;
		requestId: string;
		answer: string;
	}): Promise<unknown> {
		const runtime = this.requireCompatibleRuntime(input.connectionId);
		const binding = this.requireBinding(runtime, input.hermesSessionId);
		return runtime.client.request("clarify.respond", {
			session_id: binding.runtimeSessionId,
			request_id: input.requestId,
			answer: input.answer,
		});
	}

	async release(connectionId: string, hermesSessionId: string): Promise<unknown> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const binding = this.requireBinding(runtime, hermesSessionId);
		clearInterval(binding.renewTimer);
		const result = await runtime.client.request("session.release", { claim_id: binding.claimId });
		runtime.bindings.delete(hermesSessionId);
		runtime.runtimeToCanonical.delete(binding.runtimeSessionId);
		return result;
	}

	async origin(connectionId: string, hermesSessionId: string): Promise<HermesOriginInfo> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const result = object(
			await runtime.client.request("session.origin", {
				session_id: this.resolveCanonicalSessionId(runtime, hermesSessionId),
			})
		);
		const displayLabel = sanitizeHermesPayload(
			stringValue(result["display_label"], result["origin_label"])
		);
		return {
			displayLabel: typeof displayLabel === "string" ? displayLabel : null,
			canOpen: result["can_open_origin"] === true || result["can_open"] === true,
			canReport: result["can_report_to_origin"] === true || result["can_report"] === true,
			permalink: stringValue(result["permalink"], result["deep_link"]),
		};
	}

	async reportToOrigin(input: {
		connectionId: string;
		hermesSessionId: string;
		turnId: string;
		content: string;
	}): Promise<HermesOriginReportState> {
		const runtime = this.requireCompatibleRuntime(input.connectionId);
		const receipt = beginHermesOriginReport(input);
		if (receipt.alreadyDelivered) return receipt.state;
		try {
			const result = object(
				await runtime.client.request("session.report_to_origin", {
					session_id: this.resolveCanonicalSessionId(runtime, input.hermesSessionId),
					turn_id: input.turnId,
					content: input.content,
					idempotency_key: receipt.idempotencyKey,
				})
			);
			const duplicate = result["duplicate"] === true || result["duplicate_suppressed"] === true;
			return finishHermesOriginReport({
				...input,
				status: duplicate ? "duplicate-suppressed" : "sent",
				messageId: stringValue(result["message_id"], result["messageId"]),
				permalink: stringValue(result["permalink"], result["deep_link"]),
			});
		} catch (error) {
			return finishHermesOriginReport({
				...input,
				status: "failed",
				retryable: error instanceof HermesRpcError ? error.retryable : true,
				errorCode:
					error instanceof HermesRpcError && error.code !== null ? String(error.code) : "unknown",
			});
		}
	}

	reports(connectionId: string, hermesSessionId: string): HermesOriginReportState[] {
		return listHermesOriginReports(connectionId, hermesSessionId);
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
				this.pushEvent(connectionId, event);
				const canonical = event.sessionId
					? runtime.runtimeToCanonical.get(event.sessionId)
					: undefined;
				if (canonical && event.workspaceArtifacts.length > 0) {
					const binding = runtime.bindings.get(canonical);
					this.linkArtifacts(
						connectionId,
						canonical,
						binding?.lineageRootId ?? null,
						event.workspaceArtifacts
					);
				}
			}),
			runtime.client.subscribeState((state) => {
				this.pushEvent(connectionId, {
					type: "runtime.connection",
					sessionId: null,
					turnId: null,
					requestId: null,
					text: null,
					toolName: null,
					status: state.status,
					payload: sanitizeHermesPayload({
						reconnectAttempt: state.reconnectAttempt,
						error: state.error,
					}) as Record<string, unknown>,
					workspaceArtifacts: [],
					receivedAt: Date.now(),
				});
			})
		);
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
			sessionId: null,
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

	private requireCompatibleRuntime(connectionId: string): ConnectionRuntime {
		const runtime = this.requireRuntime(connectionId);
		if (runtime.compatibility?.state !== "compatible") throw new Error("Hermes upgrade required");
		return runtime;
	}

	private requireBinding(runtime: ConnectionRuntime, hermesSessionId: string): RuntimeBinding {
		const binding = runtime.bindings.get(hermesSessionId);
		if (!binding) throw new Error("Resume and claim the Hermes session first");
		return binding;
	}

	private resolveCanonicalSessionId(runtime: ConnectionRuntime, hermesSessionId: string): string {
		const binding = runtime.bindings.get(hermesSessionId);
		if (binding) return binding.canonicalSessionId;
		const session = runtime.catalog?.sessions.find(
			(candidate) => candidate.id === hermesSessionId || candidate.lineageTipId === hermesSessionId
		);
		return session?.lineageTipId ?? hermesSessionId;
	}

	private linkArtifacts(
		connectionId: string,
		hermesSessionId: string,
		lineageRootId: string | null,
		artifacts: ReturnType<typeof extractWorkspaceArtifacts>
	): void {
		if (artifacts.length === 0) return;
		linkHermesWorkspaceArtifacts({
			connectionId,
			hermesSessionId,
			hermesLineageRootId: lineageRootId,
			artifacts,
		});
	}

	private async backfillToolArtifacts(
		connectionId: string,
		hermesSessionId: string
	): Promise<void> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		if (!runtime.compatibility?.capabilities.includes("session.tool_artifacts")) return;
		const binding = this.requireBinding(runtime, hermesSessionId);
		const result = await runtime.client.request("session.tool_artifacts", {
			session_id: binding.canonicalSessionId,
		});
		this.linkArtifacts(
			connectionId,
			hermesSessionId,
			binding.lineageRootId,
			extractWorkspaceArtifacts(result)
		);
	}
}

export const hermesRuntimeService = new HermesRuntimeService();
