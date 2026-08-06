import { randomUUID } from "node:crypto";
import type {
	HermesBindingReleaseResult,
	HermesCatalog,
	HermesCompatibility,
	HermesOriginInfo,
	HermesOriginReportState,
	HermesRuntimeEvent,
	HermesRuntimeState,
	HermesSessionHistory,
} from "../../shared/hermes";
import { getHermesConnectionWithToken, markHermesConnectionConnected } from "./hermes-connections";
import {
	beginHermesOriginReport,
	finishHermesOriginReport,
	listHermesOriginReports,
} from "./hermes-origin-reports";
import {
	HERMES_REQUIRED_CAPABILITIES,
	type HermesExactTurnResult,
	extractExactHermesTurnResults,
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
	renewTimer: ReturnType<typeof setInterval> | null;
	active: boolean;
	claimReleased: boolean;
	releaseTask: Promise<ClaimReleaseResult> | null;
	releaseRequested: boolean;
	releaseRetryAttempts: number;
	releaseRetryTimer: ReturnType<typeof setTimeout> | null;
}

interface ClaimReleaseResult {
	released: boolean;
	retryable: boolean;
	error: string | null;
	invalidBinding: boolean;
}

interface BufferedEvent {
	seq: number;
	event: HermesRuntimeEvent;
}

interface ConnectionRuntime {
	client: HermesRuntimeClientLike;
	profileId: string;
	protocolInfo: unknown | null;
	compatibility: HermesCompatibility | null;
	catalog: HermesCatalog | null;
	bindings: Map<string, RuntimeBinding>;
	runtimeToCanonical: Map<string, string>;
	events: BufferedEvent[];
	nextSeq: number;
	unsubscribers: Array<() => void>;
	bindingTasks: Map<string, Promise<RuntimeBinding>>;
	reconnectTask: Promise<void> | null;
	durableTurnResults: Map<string, Map<string, HermesExactTurnResult>>;
}

export interface HermesRuntimeServiceOptions {
	clientFactory?: () => HermesRuntimeClientLike;
	tokenVault?: HermesTokenVault;
	clientId?: string;
	claimTtlSeconds?: number;
	renewTimerApi?: {
		set(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
		clear(timer: ReturnType<typeof setInterval>): void;
	};
	releaseRetryTimerApi?: {
		set(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
		clear(timer: ReturnType<typeof setTimeout>): void;
	};
}

const MAX_BUFFERED_EVENTS = 1_000;
const MAX_AUTOMATIC_RELEASE_RETRIES = 5;
const MAX_AUTOMATIC_RELEASE_RETRY_DELAY_MS = 5_000;

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
	private readonly renewTimerApi: NonNullable<HermesRuntimeServiceOptions["renewTimerApi"]>;
	private readonly releaseRetryTimerApi: NonNullable<
		HermesRuntimeServiceOptions["releaseRetryTimerApi"]
	>;

	constructor(options: HermesRuntimeServiceOptions = {}) {
		this.clientFactory = options.clientFactory ?? (() => new HermesRuntimeClient());
		this.tokenVault = options.tokenVault ?? hermesTokenVault;
		this.clientId = options.clientId ?? `superiorswarm-${randomUUID()}`;
		this.claimTtlSeconds = options.claimTtlSeconds ?? 60;
		this.renewTimerApi =
			options.renewTimerApi ??
			({
				set: (callback, delayMs) => setInterval(callback, delayMs),
				clear: (timer) => clearInterval(timer),
			} satisfies NonNullable<HermesRuntimeServiceOptions["renewTimerApi"]>);
		this.releaseRetryTimerApi =
			options.releaseRetryTimerApi ??
			({
				set: (callback, delayMs) => setTimeout(callback, delayMs),
				clear: (timer) => clearTimeout(timer),
			} satisfies NonNullable<HermesRuntimeServiceOptions["releaseRetryTimerApi"]>);
	}

	async connect(connectionId: string): Promise<HermesCatalog> {
		const connection = getHermesConnectionWithToken(connectionId, this.tokenVault);
		if (!connection) {
			throw new Error("Hermes token is unavailable; enter it again to reconnect");
		}
		const previousRuntime = this.runtimes.get(connectionId);
		if (previousRuntime) {
			const previousBindings = [...previousRuntime.bindings.entries()];
			for (const [hermesSessionId, binding] of previousBindings) {
				this.detachBinding(previousRuntime, hermesSessionId, binding);
			}
			await Promise.all(
				previousBindings.map(([, binding]) =>
					this.releaseClaim(connectionId, previousRuntime, binding, false, 2_000)
				)
			);
			this.disconnect(connectionId);
		}
		let runtime = this.runtimes.get(connectionId);
		if (!runtime) {
			const client = this.clientFactory();
			runtime = {
				client,
				profileId: connection.profileId,
				protocolInfo: null,
				compatibility: null,
				catalog: null,
				bindings: new Map(),
				runtimeToCanonical: new Map(),
				events: [],
				nextSeq: 0,
				unsubscribers: [],
				bindingTasks: new Map(),
				reconnectTask: null,
				durableTurnResults: new Map(),
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
			runtime.protocolInfo = await runtime.client.request("protocol.info", {});
			catalog = normalizeHermesCatalog(
				await runtime.client.request("session.catalog", { profile: connection.profileId }),
				runtime.protocolInfo
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
		for (const [hermesSessionId, binding] of runtime.bindings) {
			this.detachBinding(runtime, hermesSessionId, binding);
		}
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
			await runtime.client.request("session.catalog", { profile: connection.profileId }),
			runtime.protocolInfo
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
		history: HermesSessionHistory;
	}> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		if (runtime.reconnectTask) await runtime.reconnectTask;
		const existing = runtime.bindings.get(hermesSessionId);
		if (existing?.active) this.cancelDeferredRelease(existing);
		const acquired = !existing?.active;
		const binding = acquired
			? await this.bindSession(connectionId, runtime, hermesSessionId, existing)
			: existing;
		try {
			const history = await this.history(connectionId, hermesSessionId);
			await this.backfillToolArtifacts(connectionId, hermesSessionId).catch((error) =>
				this.pushRuntimeError(connectionId, error)
			);
			return {
				canonicalSessionId: binding.canonicalSessionId,
				runtimeSessionId: binding.runtimeSessionId,
				claimId: binding.claimId,
				history,
			};
		} catch (error) {
			if (acquired) await this.unbind(connectionId, hermesSessionId, binding.claimId);
			throw error;
		}
	}

	async history(connectionId: string, hermesSessionId: string): Promise<HermesSessionHistory> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const binding = this.requireBinding(runtime, hermesSessionId);
		const rawHistory = await runtime.client.request("session.history", {
			session_id: binding.runtimeSessionId,
		});
		const exactTurnResults = extractExactHermesTurnResults(rawHistory);
		runtime.durableTurnResults.set(
			hermesSessionId,
			new Map(exactTurnResults.map((result) => [result.turnId, result]))
		);
		const history = normalizeHermesHistory(rawHistory);
		this.linkArtifacts(
			connectionId,
			hermesSessionId,
			binding.lineageRootId,
			history.messages.flatMap((message) => message.workspaceArtifacts)
		);
		return history;
	}

	async submit(connectionId: string, hermesSessionId: string, text: string): Promise<{ ok: true }> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const binding = this.requireBinding(runtime, hermesSessionId);
		await runtime.client.request("prompt.submit", {
			session_id: binding.runtimeSessionId,
			claim_id: binding.claimId,
			text,
		});
		return { ok: true };
	}

	async interrupt(connectionId: string, hermesSessionId: string): Promise<{ ok: true }> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const binding = this.requireBinding(runtime, hermesSessionId);
		try {
			await runtime.client.request("session.interrupt", {
				session_id: binding.runtimeSessionId,
				claim_id: binding.claimId,
			});
		} finally {
			this.triggerDeferredRelease(connectionId, runtime, hermesSessionId, binding, true);
		}
		return { ok: true };
	}

	async respondToApproval(input: {
		connectionId: string;
		hermesSessionId: string;
		requestId: string;
		choice: string;
	}): Promise<{ ok: true }> {
		const runtime = this.requireCompatibleRuntime(input.connectionId);
		const binding = this.requireBinding(runtime, input.hermesSessionId);
		await runtime.client.request("approval.respond", {
			session_id: binding.runtimeSessionId,
			claim_id: binding.claimId,
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
		const runtime = this.requireCompatibleRuntime(input.connectionId);
		const binding = this.requireBinding(runtime, input.hermesSessionId);
		await runtime.client.request("clarify.respond", {
			session_id: binding.runtimeSessionId,
			claim_id: binding.claimId,
			request_id: input.requestId,
			answer: input.answer,
		});
		return { ok: true };
	}

	async release(
		connectionId: string,
		hermesSessionId: string
	): Promise<HermesBindingReleaseResult> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const binding = runtime.bindings.get(hermesSessionId);
		if (!binding) throw new Error("Resume and claim the Hermes session first");
		return this.unbind(connectionId, hermesSessionId, binding.claimId);
	}

	async unbind(
		connectionId: string,
		hermesSessionId: string,
		expectedClaimId: string
	): Promise<HermesBindingReleaseResult> {
		const runtime = this.runtimes.get(connectionId);
		if (!runtime) {
			return {
				unbound: false,
				released: false,
				retryable: false,
				error: "Hermes is disconnected",
			};
		}
		const binding = runtime.bindings.get(hermesSessionId);
		if (!binding || binding.claimId !== expectedClaimId) {
			return { unbound: false, released: false, retryable: false, error: null };
		}

		binding.releaseRequested = true;
		binding.releaseRetryAttempts = 0;
		this.clearReleaseRetryTimer(binding);
		return this.attemptRequestedRelease(connectionId, runtime, hermesSessionId, binding, true);
	}

	async origin(connectionId: string, hermesSessionId: string): Promise<HermesOriginInfo> {
		const runtime = this.requireCompatibleRuntime(connectionId);
		const result = object(
			await runtime.client.request("session.origin", {
				session_id: this.resolveCanonicalSessionId(runtime, hermesSessionId),
				profile: runtime.profileId,
			})
		);
		const origin = object(result["origin"]);
		const displayLabel = sanitizeHermesPayload(
			stringValue(
				origin["label"],
				origin["display_label"],
				origin["origin_label"],
				result["display_label"],
				result["origin_label"]
			)
		);
		return {
			displayLabel: typeof displayLabel === "string" ? displayLabel : null,
			canOpen:
				origin["can_open_origin"] === true ||
				origin["can_open"] === true ||
				result["can_open_origin"] === true ||
				result["can_open"] === true,
			canReport:
				origin["can_report_to_origin"] === true ||
				origin["can_report"] === true ||
				result["can_report_to_origin"] === true ||
				result["can_report"] === true,
			permalink: stringValue(
				origin["deep_link"],
				origin["permalink"],
				result["permalink"],
				result["deep_link"]
			),
		};
	}

	async reportToOrigin(input: {
		connectionId: string;
		hermesSessionId: string;
		turnId: string;
	}): Promise<HermesOriginReportState> {
		const runtime = this.requireCompatibleRuntime(input.connectionId);
		const receipt = beginHermesOriginReport(input);
		if (receipt.alreadyDelivered) return receipt.state;
		try {
			let durableResult = runtime.durableTurnResults.get(input.hermesSessionId)?.get(input.turnId);
			if (!durableResult) {
				await this.history(input.connectionId, input.hermesSessionId);
				durableResult = runtime.durableTurnResults.get(input.hermesSessionId)?.get(input.turnId);
			}
			if (!durableResult) {
				return finishHermesOriginReport({
					...input,
					status: "failed",
					retryable: true,
					errorCode: "durable-result-unavailable",
				});
			}
			const durableStatus = durableResult.status?.toLocaleLowerCase();
			if (["error", "failed", "cancelled"].includes(durableStatus ?? "")) {
				return finishHermesOriginReport({
					...input,
					status: "failed",
					retryable: false,
					errorCode: "turn-not-reportable",
				});
			}
			const result = object(
				await runtime.client.request("session.report_to_origin", {
					session_id: this.resolveCanonicalSessionId(runtime, input.hermesSessionId),
					turn_id: input.turnId,
					content: durableResult.content,
					idempotency_key: receipt.idempotencyKey,
					profile: runtime.profileId,
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
				if (event.type === "runtime.history-refresh-required") {
					this.rebindAfterReconnect(connectionId, runtime);
					return;
				}
				this.pushEvent(connectionId, event);
				const canonical = event.sessionId
					? runtime.runtimeToCanonical.get(event.sessionId)
					: undefined;
				if (canonical) {
					const binding = runtime.bindings.get(canonical);
					if (event.workspaceArtifacts.length > 0) {
						this.linkArtifacts(
							connectionId,
							canonical,
							binding?.lineageRootId ?? null,
							event.workspaceArtifacts
						);
					}
					if (binding && this.isTurnTerminalEvent(event)) {
						this.triggerDeferredRelease(connectionId, runtime, canonical, binding, true);
					}
				}
			}),
			runtime.client.subscribeState((state) => {
				const sanitizedError = sanitizeHermesPayload(state.error);
				this.pushEvent(connectionId, {
					type: "runtime.connection",
					sessionId: null,
					turnId: null,
					requestId: null,
					text: typeof sanitizedError === "string" ? sanitizedError : null,
					toolName: null,
					status: state.status,
					payload: {},
					workspaceArtifacts: [],
					receivedAt: Date.now(),
				});
			})
		);
	}

	private rebindAfterReconnect(connectionId: string, runtime: ConnectionRuntime): void {
		if (runtime.reconnectTask || this.runtimes.get(connectionId) !== runtime) return;
		const task = this.rebindDurableSessions(connectionId, runtime);
		runtime.reconnectTask = task;
		const cleanup = () => {
			if (runtime.reconnectTask === task) runtime.reconnectTask = null;
		};
		void task.then(cleanup, cleanup);
	}

	private async rebindDurableSessions(
		connectionId: string,
		runtime: ConnectionRuntime
	): Promise<void> {
		const durableBindings = [...runtime.bindings.entries()];
		for (const [, binding] of durableBindings) {
			this.clearRenewTimer(binding);
			binding.active = false;
		}

		const results = await Promise.all(
			durableBindings.map(async ([hermesSessionId, previous]) => {
				try {
					const binding = await this.bindSession(connectionId, runtime, hermesSessionId, previous);
					await this.history(connectionId, hermesSessionId).catch((error) =>
						this.pushRuntimeError(connectionId, error)
					);
					await this.backfillToolArtifacts(connectionId, hermesSessionId).catch((error) =>
						this.pushRuntimeError(connectionId, error)
					);
					return {
						hermesSessionId,
						canonicalSessionId: binding.canonicalSessionId,
						runtimeSessionId: binding.runtimeSessionId,
						claimId: binding.claimId,
					};
				} catch (error) {
					if (runtime.bindings.get(hermesSessionId) === previous) {
						runtime.runtimeToCanonical.delete(previous.runtimeSessionId);
					}
					this.pushRuntimeError(connectionId, error);
					return null;
				}
			})
		);
		if (this.runtimes.get(connectionId) !== runtime) return;
		const bindings = results.filter(
			(result): result is NonNullable<typeof result> => result !== null
		);
		this.pushEvent(connectionId, {
			type: "runtime.history-refresh-required",
			sessionId: null,
			turnId: null,
			requestId: null,
			text: null,
			toolName: null,
			status: bindings.length === results.length ? "reconnected" : "recoverable-error",
			payload: {
				bindings,
				failedSessionIds: durableBindings
					.map(([hermesSessionId]) => hermesSessionId)
					.filter((hermesSessionId) =>
						bindings.every((binding) => binding.hermesSessionId !== hermesSessionId)
					),
			},
			workspaceArtifacts: [],
			receivedAt: Date.now(),
		});
	}

	private bindSession(
		connectionId: string,
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		previous: RuntimeBinding | undefined
	): Promise<RuntimeBinding> {
		const pending = runtime.bindingTasks.get(hermesSessionId);
		if (pending) return pending;
		const task = this.acquireBinding(connectionId, runtime, hermesSessionId, previous);
		runtime.bindingTasks.set(hermesSessionId, task);
		const cleanup = () => {
			if (runtime.bindingTasks.get(hermesSessionId) === task) {
				runtime.bindingTasks.delete(hermesSessionId);
			}
		};
		void task.then(cleanup, cleanup);
		return task;
	}

	private async acquireBinding(
		connectionId: string,
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		previous: RuntimeBinding | undefined
	): Promise<RuntimeBinding> {
		const session = runtime.catalog?.sessions.find(
			(candidate) => candidate.id === hermesSessionId || candidate.lineageTipId === hermesSessionId
		);
		const canonicalSessionId =
			previous?.canonicalSessionId ?? session?.lineageTipId ?? hermesSessionId;
		let claimId: string | null = null;
		let installed = false;
		try {
			const claimResult = object(
				await runtime.client.request("session.claim", {
					session_id: canonicalSessionId,
					surface: "superiorswarm",
					client_id: this.clientId,
					ttl_seconds: this.claimTtlSeconds,
					profile: runtime.profileId,
				})
			);
			const claim = object(claimResult["claim"]);
			claimId = stringValue(
				claim["claim_id"],
				claim["claimId"],
				claimResult["claim_id"],
				claimResult["claimId"]
			);
			if (!claimId) throw new Error("Hermes returned an invalid session claim");

			const resumed = object(
				await runtime.client.request("session.resume", {
					session_id: canonicalSessionId,
					source: "superiorswarm",
					profile: runtime.profileId,
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
					resumed["lineage_tip_id"],
					resumed["resumed"],
					resumed["session_key"]
				) ?? canonicalSessionId;

			if (
				this.runtimes.get(connectionId) !== runtime ||
				(previous
					? runtime.bindings.get(hermesSessionId) !== previous
					: runtime.bindings.has(hermesSessionId))
			) {
				throw new Error("Hermes session binding changed while it was resuming");
			}

			const binding: RuntimeBinding = {
				canonicalSessionId: resolvedCanonicalSessionId,
				runtimeSessionId,
				lineageRootId: previous?.lineageRootId ?? session?.lineageRootId ?? null,
				claimId,
				renewTimer: null,
				active: true,
				claimReleased: false,
				releaseTask: null,
				releaseRequested: previous?.releaseRequested ?? false,
				releaseRetryAttempts: previous?.releaseRetryAttempts ?? 0,
				releaseRetryTimer: null,
			};
			binding.renewTimer = this.createRenewTimer(connectionId, runtime, binding);
			if (previous) this.detachBinding(runtime, hermesSessionId, previous, false);
			runtime.bindings.set(hermesSessionId, binding);
			runtime.runtimeToCanonical.set(runtimeSessionId, hermesSessionId);
			installed = true;
			if (binding.releaseRequested) {
				this.scheduleDeferredRelease(connectionId, runtime, hermesSessionId, binding);
			}

			if (previous && previous.claimId !== claimId && !previous.claimReleased) {
				await this.releaseClaim(connectionId, runtime, previous, false);
			}
			return binding;
		} catch (error) {
			if (claimId && !installed) {
				const failedBinding: RuntimeBinding = {
					canonicalSessionId,
					runtimeSessionId: "",
					lineageRootId: previous?.lineageRootId ?? session?.lineageRootId ?? null,
					claimId,
					renewTimer: null,
					active: false,
					claimReleased: false,
					releaseTask: null,
					releaseRequested: false,
					releaseRetryAttempts: 0,
					releaseRetryTimer: null,
				};
				await this.releaseClaim(connectionId, runtime, failedBinding, false);
			}
			if (previous && !previous.claimReleased) {
				await this.releaseClaim(connectionId, runtime, previous, false);
			}
			throw error;
		}
	}

	private createRenewTimer(
		connectionId: string,
		runtime: ConnectionRuntime,
		binding: RuntimeBinding
	): ReturnType<typeof setInterval> {
		const renewTimer = this.renewTimerApi.set(
			() => {
				if (!binding.active || binding.claimReleased) return;
				void runtime.client
					.request("session.claim_renew", {
						claim_id: binding.claimId,
						ttl_seconds: this.claimTtlSeconds,
						profile: runtime.profileId,
					})
					.catch((error) => this.pushRuntimeError(connectionId, error));
			},
			Math.max(5_000, (this.claimTtlSeconds * 1_000) / 2)
		);
		renewTimer.unref?.();
		return renewTimer;
	}

	private clearRenewTimer(binding: RuntimeBinding): void {
		if (!binding.renewTimer) return;
		this.renewTimerApi.clear(binding.renewTimer);
		binding.renewTimer = null;
	}

	private clearReleaseRetryTimer(binding: RuntimeBinding): void {
		if (!binding.releaseRetryTimer) return;
		this.releaseRetryTimerApi.clear(binding.releaseRetryTimer);
		binding.releaseRetryTimer = null;
	}

	private cancelDeferredRelease(binding: RuntimeBinding): void {
		binding.releaseRequested = false;
		binding.releaseRetryAttempts = 0;
		this.clearReleaseRetryTimer(binding);
	}

	private isCurrentBinding(
		connectionId: string,
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		binding: RuntimeBinding
	): boolean {
		return (
			this.runtimes.get(connectionId) === runtime &&
			runtime.bindings.get(hermesSessionId) === binding
		);
	}

	private isTurnTerminalEvent(event: HermesRuntimeEvent): boolean {
		return (
			event.type === "message.complete" ||
			event.type === "turn.complete" ||
			event.type === "turn.completed" ||
			event.type === "turn.failed" ||
			event.type === "turn.cancelled"
		);
	}

	private triggerDeferredRelease(
		connectionId: string,
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		binding: RuntimeBinding,
		reportError: boolean
	): void {
		if (
			!binding.releaseRequested ||
			!this.isCurrentBinding(connectionId, runtime, hermesSessionId, binding)
		) {
			return;
		}
		this.clearReleaseRetryTimer(binding);
		void this.attemptRequestedRelease(connectionId, runtime, hermesSessionId, binding, reportError);
	}

	private scheduleDeferredRelease(
		connectionId: string,
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		binding: RuntimeBinding
	): void {
		if (
			binding.releaseRetryTimer ||
			!binding.releaseRequested ||
			!this.isCurrentBinding(connectionId, runtime, hermesSessionId, binding)
		) {
			return;
		}
		if (binding.releaseRetryAttempts >= MAX_AUTOMATIC_RELEASE_RETRIES) {
			binding.releaseRequested = false;
			this.detachBinding(runtime, hermesSessionId, binding);
			return;
		}

		const delayMs = Math.min(
			250 * 2 ** binding.releaseRetryAttempts,
			MAX_AUTOMATIC_RELEASE_RETRY_DELAY_MS
		);
		binding.releaseRetryAttempts++;
		binding.releaseRetryTimer = this.releaseRetryTimerApi.set(() => {
			binding.releaseRetryTimer = null;
			this.triggerDeferredRelease(connectionId, runtime, hermesSessionId, binding, false);
		}, delayMs);
		binding.releaseRetryTimer.unref?.();
	}

	private async attemptRequestedRelease(
		connectionId: string,
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		binding: RuntimeBinding,
		reportError: boolean
	): Promise<HermesBindingReleaseResult> {
		if (
			!binding.releaseRequested ||
			!this.isCurrentBinding(connectionId, runtime, hermesSessionId, binding)
		) {
			return { unbound: false, released: false, retryable: false, error: null };
		}

		this.clearReleaseRetryTimer(binding);
		const result = await this.releaseClaim(connectionId, runtime, binding, reportError);
		if (!this.isCurrentBinding(connectionId, runtime, hermesSessionId, binding)) {
			return {
				unbound: false,
				released: result.released,
				retryable: result.retryable,
				error: result.error,
			};
		}

		if (result.released || result.invalidBinding) {
			binding.releaseRequested = false;
			this.detachBinding(runtime, hermesSessionId, binding);
			return {
				unbound: true,
				released: result.released,
				retryable: false,
				error: result.error,
			};
		}

		binding.active = true;
		binding.renewTimer ??= this.createRenewTimer(connectionId, runtime, binding);
		runtime.runtimeToCanonical.set(binding.runtimeSessionId, hermesSessionId);
		this.scheduleDeferredRelease(connectionId, runtime, hermesSessionId, binding);
		return { unbound: false, released: false, retryable: result.retryable, error: result.error };
	}

	private releaseClaim(
		connectionId: string,
		runtime: ConnectionRuntime,
		binding: RuntimeBinding,
		reportError = true,
		timeoutMs?: number
	): Promise<ClaimReleaseResult> {
		if (binding.releaseTask) return binding.releaseTask;
		if (binding.claimReleased) {
			return Promise.resolve({
				released: true,
				retryable: false,
				error: null,
				invalidBinding: false,
			});
		}
		binding.active = false;
		this.clearRenewTimer(binding);
		const task = runtime.client
			.request(
				"session.release",
				{ claim_id: binding.claimId, profile: runtime.profileId },
				timeoutMs === undefined ? undefined : { timeoutMs }
			)
			.then((value) => {
				const result = object(value);
				if (result["released"] === false || result["busy"] === true) {
					const sanitized = sanitizeHermesPayload(
						stringValue(result["error"], result["message"], result["reason"]) ??
							"Hermes could not release the session claim"
					);
					return {
						released: false,
						retryable: result["retryable"] !== false,
						invalidBinding: result["retryable"] === false,
						error:
							typeof sanitized === "string"
								? sanitized
								: "Hermes could not release the session claim",
					};
				}
				binding.claimReleased = true;
				return { released: true, retryable: false, error: null, invalidBinding: false };
			})
			.catch((error) => {
				if (reportError) this.pushRuntimeError(connectionId, error);
				const sanitized = sanitizeHermesPayload(
					error instanceof Error ? error.message : "Hermes claim release failed"
				);
				const retryable = error instanceof HermesRpcError ? error.retryable : true;
				return {
					released: false,
					retryable,
					invalidBinding: !retryable,
					error: typeof sanitized === "string" ? sanitized : "Hermes claim release failed",
				};
			});
		binding.releaseTask = task;
		const resetFailedTask = (result: ClaimReleaseResult) => {
			if (!result.released && binding.releaseTask === task) binding.releaseTask = null;
		};
		void task.then(resetFailedTask);
		return task;
	}

	private detachBinding(
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		binding: RuntimeBinding,
		remove = true
	): void {
		this.clearRenewTimer(binding);
		this.clearReleaseRetryTimer(binding);
		binding.active = false;
		runtime.runtimeToCanonical.delete(binding.runtimeSessionId);
		if (remove && runtime.bindings.get(hermesSessionId) === binding) {
			runtime.bindings.delete(hermesSessionId);
		}
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
		if (!binding?.active) throw new Error("Resume and claim the Hermes session first");
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
			profile: runtime.profileId,
		});
		this.linkArtifacts(
			connectionId,
			hermesSessionId,
			binding.lineageRootId,
			extractWorkspaceArtifacts(result, "tool-artifacts-result")
		);
	}
}

export const hermesRuntimeService = new HermesRuntimeService();
