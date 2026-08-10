import { randomUUID } from "node:crypto";
import {
	type HermesActiveTurnSnapshot,
	type HermesCatalog,
	type HermesOriginProjection,
	type HermesOriginReportState,
	type HermesPendingInteractionSnapshot,
	type HermesQueuedFollowUpRuntimeSummary,
	type HermesQueuedFollowUpSummary,
	type HermesReconnectBindingMetadata,
	type HermesRuntimeEvent,
	type HermesRuntimeState,
	type HermesSessionBinding,
	type HermesSessionHistory,
	type HermesSessionSummary,
	hermesSessionCompositeIdentityKey,
	hermesSessionIdentityKey,
	isSafeHermesFileReference,
} from "../../shared/hermes";
import { resolveInstalledHermesManagerId } from "../services/external-managers";
import {
	type HermesAttachedResult,
	type HermesAttachmentStore,
	type HermesResolvedAttachment,
	buildHermesAttachmentPromptText,
	hermesAttachmentStore,
} from "./hermes-attachments";
import {
	getHermesConnectionWithToken,
	listHermesConnections,
	markHermesConnectionConnected,
	saveHermesConnection,
	setHermesConnectionAutoManagerId,
} from "./hermes-connections";
import { discoverHermesDashboardToken } from "./hermes-dashboard-token";
import {
	type HermesLocalBackendInvalidation,
	type HermesLocalBackendManagerLike,
	hermesLocalBackendManager,
} from "./hermes-local-backend-manager";
import {
	deleteHermesOriginLink,
	getHermesOriginLink,
	saveHermesOriginLink,
} from "./hermes-origin-links";
import {
	beginHermesOriginReportAttempt,
	deleteHermesOriginReports,
	finishHermesOriginReport,
	listHermesOriginReports,
	prepareHermesOriginReport,
} from "./hermes-origin-reports";
import { type ResolvedHermesOrigin, resolveHermesOrigin } from "./hermes-origin-resolver";
import {
	type extractWorkspaceArtifacts,
	normalizeHermesActiveTurnSnapshot,
	normalizeHermesRuntimeActivity,
	normalizeHermesSessionBinding,
	sanitizeHermesPayload,
} from "./hermes-protocol";
import { HermesRestClient, type HermesStockSessionDetail } from "./hermes-rest-client";
import {
	HermesRpcError,
	HermesRuntimeClient,
	type HermesRuntimeConnectionSettings,
} from "./hermes-runtime-client";
import { HermesSendError, HermesSendService } from "./hermes-send-service";
import {
	admitHermesSession,
	deleteHermesSessionAdmission,
	filterManagedHermesSessionCatalog,
} from "./hermes-session-admissions";
import { type HermesTokenVault, hermesTokenVault } from "./hermes-token-vault";
import {
	canonicalizeHermesWorkspaceLinks,
	deleteHermesSessionWorkspaceLinks,
	linkHermesWorkspaceArtifacts,
} from "./hermes-workspace-links";

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
	setSessionArchived(
		durableSessionId: string,
		profileId: string,
		archived: boolean,
		signal?: AbortSignal
	): Promise<void>;
	deleteSession(durableSessionId: string, profileId: string, signal?: AbortSignal): Promise<void>;
	getSessionDetail(
		durableSessionId: string,
		profileId?: string,
		signal?: AbortSignal
	): Promise<HermesStockSessionDetail>;
	getTranscript(
		durableSessionId: string,
		profileId?: string,
		signal?: AbortSignal
	): Promise<HermesSessionHistory>;
}

export interface HermesSendServiceLike {
	isAvailable(): boolean;
	send(input: Parameters<HermesSendService["send"]>[0]): ReturnType<HermesSendService["send"]>;
}

interface BufferedEvent {
	seq: number;
	event: HermesRuntimeEvent;
}

interface RuntimeBinding extends HermesSessionBinding {
	activeTurn: boolean;
	runtimeStatus: string | null;
	activeTurnSnapshot: HermesActiveTurnSnapshot;
	turnGeneration: number;
	activeTurnIdentity: {
		generation: number;
		runtimeSessionId: string;
		turnId: string | null;
	} | null;
	processedTerminalIdentities: string[];
	pendingTerminalEvents: HermesRuntimeEvent[];
}

interface QueuedFollowUp extends HermesQueuedFollowUpSummary {
	attachmentHandles: string[];
	ownerId: string;
	wasQueued: boolean;
	transportUncertain: boolean;
	deliveryKey: string;
	deliveryTurnId: string | null;
	submittedPromptText: string | null;
}

interface SessionFollowUpQueue {
	connectionId: string;
	profileId: string;
	durableSessionId: string;
	items: QueuedFollowUp[];
	active: QueuedFollowUp | null;
	settled: QueuedFollowUp[];
	draining: Promise<void> | null;
	admissionTail: Promise<void>;
	admissions: number;
	generation: number;
	valid: boolean;
	activeTurnGeneration: number | null;
}

interface ConnectionRuntime {
	client: HermesRuntimeClientLike;
	rest: HermesRestClientLike;
	profileId: string;
	connectionMode: "loopback" | "remote";
	managementMode: "managed" | "external";
	managerId: string | null;
	managedBaseUrl: string | null;
	catalog: HermesCatalog;
	bindings: Map<string, RuntimeBinding>;
	runtimeToDurable: Map<string, { durableSessionId: string; profileId: string }>;
	aliases: Map<string, string>;
	events: BufferedEvent[];
	nextSeq: number;
	unsubscribers: Array<() => void>;
	reconnectTask: Promise<void> | null;
	histories: Map<string, HermesSessionHistory>;
	origins: Map<string, ResolvedHermesOrigin>;
}

interface ConnectionOperation {
	generation: number;
	controller: AbortController;
	managementMode: "managed" | "external" | null;
	managedProfileId: string | null;
	managedBaseUrl: string | null;
	previousRuntime: ConnectionRuntime | null;
}

export interface HermesRuntimeServiceOptions {
	clientFactory?: () => HermesRuntimeClientLike;
	restClientFactory?: (settings: {
		baseUrl: string;
		profileId: string;
		token: string;
	}) => HermesRestClientLike;
	tokenVault?: HermesTokenVault;
	sendService?: HermesSendServiceLike;
	loopbackTokenResolver?: (baseUrl: string) => Promise<string>;
	localBackendManager?: HermesLocalBackendManagerLike;
	recoveryBaseMs?: number;
	recoveryMaxMs?: number;
	attachmentStore?: HermesAttachmentStore;
	followUpIdFactory?: () => string;
	now?: () => number;
	externalManagerIdResolver?: (
		connection: ReturnType<typeof listHermesConnections>[number]
	) => string | null;
}

export interface HermesDeleteSessionResult {
	committed: true;
	catalog: HermesCatalog | null;
	reconciliationRequired: boolean;
}

const MAX_BUFFERED_EVENTS = 1_000;
const PROMPT_SUBMIT_TIMEOUT_MS = 1_800_000;
const DEFAULT_RECOVERY_BASE_MS = 500;
const DEFAULT_RECOVERY_MAX_MS = 15_000;
const MAX_ACCEPTED_FOLLOW_UP_LEDGER = 100;
const MAX_PROCESSED_TERMINAL_IDENTITIES = 128;
const MAX_PENDING_TERMINAL_EVENTS = 16;

function runtimeRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function runtimeString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

function responseTurnId(value: unknown): string | null {
	const result = runtimeRecord(value);
	return runtimeString(result?.["current_turn_id"], result?.["turn_id"], result?.["turnId"]);
}

interface DeliveryEvidenceMessage {
	id: string | null;
	turnId: string | null;
	text: string;
	deliveryKey: string | null;
}

function responseDeliveryEvidence(value: unknown): {
	turnId: string | null;
	deliveryKeys: Set<string>;
	userMessages: DeliveryEvidenceMessage[];
} {
	const result = runtimeRecord(value);
	const deliveryKeys = new Set<string>();
	const rootKey = runtimeString(
		result?.["idempotency_key"],
		result?.["idempotencyKey"],
		result?.["submission_id"]
	);
	if (rootKey) deliveryKeys.add(rootKey);
	const rows = Array.isArray(result?.["messages"]) ? result["messages"] : [];
	const userMessages = rows.flatMap((value): DeliveryEvidenceMessage[] => {
		const row = runtimeRecord(value);
		if (!row || runtimeString(row["role"])?.toLocaleLowerCase() !== "user") return [];
		const text = runtimeString(row["content"], row["text"], row["message"]);
		if (!text) return [];
		const deliveryKey = runtimeString(
			row["idempotency_key"],
			row["idempotencyKey"],
			row["submission_id"]
		);
		if (deliveryKey) deliveryKeys.add(deliveryKey);
		return [
			{
				id: runtimeString(row["canonical_message_id"], row["id"]),
				turnId: runtimeString(row["turn_id"], row["turnId"]),
				text,
				deliveryKey,
			},
		];
	});
	return { turnId: responseTurnId(value), deliveryKeys, userMessages };
}

function connectionCancelledError(): Error {
	return new Error("Hermes connection cancelled");
}

function sanitizedConnectionError(error: unknown): Error {
	const sanitized = sanitizeHermesPayload(
		error instanceof Error ? error.message : "Hermes connection failed"
	);
	return new Error(typeof sanitized === "string" ? sanitized : "Hermes connection failed");
}

class HermesAttachmentRpcError extends Error {}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(connectionCancelledError());
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(connectionCancelledError());
		signal.addEventListener("abort", onAbort, { once: true });
		void operation.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			}
		);
	});
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(connectionCancelledError());
	return new Promise<void>((resolve, reject) => {
		const finish = (error?: Error) => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			if (error) reject(error);
			else resolve();
		};
		const onAbort = () => finish(connectionCancelledError());
		const timer = setTimeout(finish, milliseconds);
		timer.unref?.();
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function sessionTitleFromTopic(topic: string): string {
	const firstLine = topic
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);
	return (firstLine ?? "New agent session").replace(/\s+/g, " ").slice(0, 100);
}

function stockCatalog(
	sessions: HermesSessionSummary[],
	connectionMode: "loopback" | "remote",
	senderAvailable: boolean,
	managerId: string | null
): HermesCatalog {
	return {
		compatibility: {
			state: "compatible",
			authMode: "token",
			canBrowse: true,
			canChat: true,
			canReport: connectionMode === "loopback" && senderAvailable,
			limitations:
				connectionMode === "remote"
					? ["Slack reporting requires a sender configured for this remote profile"]
					: ["Slack reporting is available only for validated threaded origins"],
		},
		sessions: filterManagedHermesSessionCatalog({ managerId, sessions }),
	};
}

function reconcileHermesHistory(
	cached: HermesSessionHistory | undefined,
	incoming: HermesSessionHistory
): HermesSessionHistory {
	if (cached?.view !== "durable" || incoming.view !== "active") return incoming;
	const ids = new Set(cached.messages.map((message) => message.id));
	const messages = [...cached.messages];
	for (const message of incoming.messages) {
		if (ids.has(message.id)) continue;
		ids.add(message.id);
		messages.push(message);
	}
	return {
		durableSessionId: incoming.durableSessionId,
		view: "durable",
		messages,
	};
}

export class HermesRuntimeService {
	private readonly runtimes = new Map<string, ConnectionRuntime>();
	private readonly clientFactory: () => HermesRuntimeClientLike;
	private readonly restClientFactory: NonNullable<HermesRuntimeServiceOptions["restClientFactory"]>;
	private readonly tokenVault: HermesTokenVault;
	private readonly sendService: HermesSendServiceLike;
	private readonly loopbackTokenResolver: (baseUrl: string) => Promise<string>;
	private readonly localBackendManager: HermesLocalBackendManagerLike;
	private readonly recoveryBaseMs: number;
	private readonly recoveryMaxMs: number;
	private readonly attachmentStore: HermesAttachmentStore;
	private readonly followUpIdFactory: () => string;
	private readonly now: () => number;
	private readonly externalManagerIdResolver: NonNullable<
		HermesRuntimeServiceOptions["externalManagerIdResolver"]
	>;
	private readonly connectionGenerations = new Map<string, number>();
	private readonly connectionOperations = new Map<string, ConnectionOperation>();
	private readonly connectionStates = new Map<string, HermesRuntimeState>();
	private readonly submitReservations = new Map<string, Set<string>>();
	private readonly followUpQueues = new Map<string, SessionFollowUpQueue>();
	private readonly unsubscribeBackendInvalidation: () => void;
	private closed = false;

	constructor(options: HermesRuntimeServiceOptions = {}) {
		this.clientFactory = options.clientFactory ?? (() => new HermesRuntimeClient());
		this.restClientFactory =
			options.restClientFactory ?? ((settings) => new HermesRestClient(settings));
		this.tokenVault = options.tokenVault ?? hermesTokenVault;
		this.sendService = options.sendService ?? new HermesSendService();
		this.loopbackTokenResolver = options.loopbackTokenResolver ?? discoverHermesDashboardToken;
		this.localBackendManager = options.localBackendManager ?? hermesLocalBackendManager;
		this.recoveryBaseMs = options.recoveryBaseMs ?? DEFAULT_RECOVERY_BASE_MS;
		this.recoveryMaxMs = options.recoveryMaxMs ?? DEFAULT_RECOVERY_MAX_MS;
		this.attachmentStore = options.attachmentStore ?? hermesAttachmentStore;
		this.followUpIdFactory = options.followUpIdFactory ?? randomUUID;
		this.now = options.now ?? Date.now;
		this.externalManagerIdResolver =
			options.externalManagerIdResolver ??
			((connection) =>
				connection.connectionMode === "loopback" ? resolveInstalledHermesManagerId() : null);
		this.unsubscribeBackendInvalidation = this.localBackendManager.subscribeRuntimeInvalidated(
			(event) => {
				this.handleBackendInvalidation(event);
			}
		);
	}

	async connect(connectionId: string): Promise<HermesCatalog> {
		if (this.closed) throw new Error("Hermes runtime service is shut down");
		const operation = this.beginConnectionOperation(connectionId, false);
		this.connectionStates.set(connectionId, {
			status: "connecting",
			reconnectAttempt: 0,
			lastConnectedAt: null,
			error: null,
		});
		try {
			const catalog = await this.establishConnection(connectionId, operation);
			this.finishConnectionOperation(connectionId, operation);
			this.drainConnectionFollowUps(connectionId);
			return catalog;
		} catch (error) {
			if (!this.isCurrentOperation(connectionId, operation)) {
				throw connectionCancelledError();
			}
			this.finishConnectionOperation(connectionId, operation);
			const sanitized = sanitizedConnectionError(error);
			this.connectionStates.set(connectionId, {
				status: "error",
				reconnectAttempt: 0,
				lastConnectedAt: null,
				error: sanitized.message,
			});
			throw sanitized;
		}
	}

	disconnect(connectionId: string): void {
		this.invalidateConnectionOperation(connectionId);
		this.disposeInstalledRuntime(connectionId);
		for (const queue of this.followUpQueues.values()) {
			if (queue.connectionId !== connectionId) continue;
			const uncertain = queue.items.find((followUp) => followUp.status === "submitting");
			if (uncertain) {
				uncertain.status = "failed";
				uncertain.transportUncertain = true;
				uncertain.error =
					"Hermes disconnected before confirming delivery. Retry this follow-up when safe.";
			}
			queue.draining = null;
		}
		this.connectionStates.delete(connectionId);
		this.submitReservations.delete(connectionId);
	}

	forgetConnection(connectionId: string): void {
		this.disconnect(connectionId);
		for (const [key, queue] of this.followUpQueues) {
			if (queue.connectionId !== connectionId) continue;
			queue.valid = false;
			queue.generation++;
			for (const followUp of queue.items) {
				this.attachmentStore.releaseClaim(followUp.attachmentHandles, followUp.ownerId);
			}
			queue.items = [];
			queue.active = null;
			queue.settled = [];
			queue.activeTurnGeneration = null;
			this.followUpQueues.delete(key);
		}
	}

	getState(connectionId: string): HermesRuntimeState {
		const state = this.runtimes.get(connectionId)?.client.getState() ??
			this.connectionStates.get(connectionId) ?? {
				status: "disconnected",
				reconnectAttempt: 0,
				lastConnectedAt: null,
				error: null,
			};
		return { ...state, queuedFollowUps: this.connectionQueueSummaries(connectionId) };
	}

	async catalog(connectionId: string): Promise<HermesCatalog> {
		const runtime = this.requireRuntime(connectionId);
		return await this.refreshCatalog(runtime);
	}

	async setSessionArchived(
		connectionId: string,
		profileId: string,
		hermesSessionId: string,
		archived: boolean
	): Promise<HermesCatalog> {
		const runtime = this.requireRuntime(connectionId);
		await this.refreshCatalog(runtime);
		const durableSessionId = this.resolveDurableId(runtime, hermesSessionId, profileId);
		const summary = this.requireCatalogSession(runtime, profileId, durableSessionId);
		await runtime.rest.setSessionArchived(durableSessionId, summary.profileId, archived);
		return await this.refreshCatalog(runtime);
	}

	async deleteSession(
		connectionId: string,
		profileId: string,
		hermesSessionId: string,
		confirmed: boolean
	): Promise<HermesDeleteSessionResult> {
		if (!confirmed) throw new Error("Permanent Hermes session deletion requires confirmation");
		const runtime = this.requireRuntime(connectionId);
		const durableSessionId = this.resolveDurableId(runtime, hermesSessionId, profileId);
		const relatedSessionIds = this.relatedSessionIds(runtime, profileId, durableSessionId);
		const followUpQueue = this.followUpQueues.get(
			hermesSessionCompositeIdentityKey(connectionId, profileId, durableSessionId)
		);
		if (
			followUpQueue &&
			(followUpQueue.active || followUpQueue.items.length > 0 || followUpQueue.admissions > 0)
		) {
			throw new Error("Cancel this session's queued follow-ups before deleting it");
		}
		const deletionReservation = this.reserveSubmit(
			runtime,
			connectionId,
			durableSessionId,
			profileId
		);
		try {
			const existingBinding = this.bindingFor(runtime, durableSessionId, profileId);
			if (existingBinding) this.assertLocallyIdle(existingBinding);
			await this.refreshCatalog(runtime);
			let summary = this.requireCatalogSession(runtime, profileId, durableSessionId);
			if (summary.running || summary.busy || summary.waitingForUser) {
				throw new Error("Stop the Hermes session's active turn before deleting it");
			}
			const binding = await this.refreshRuntimeIdleProof(runtime, profileId, durableSessionId);
			this.assertLocallyIdle(binding);

			// Stock Hermes has no atomic "delete only if idle" precondition. Refreshing both
			// runtime activity and the REST catalog immediately before DELETE narrows, but
			// cannot eliminate, an external activation race. The renderer therefore keeps
			// permanent deletion disabled and directs users to archive instead.
			await this.refreshCatalog(runtime);
			summary = this.requireCatalogSession(runtime, profileId, durableSessionId);
			if (summary.running || summary.busy || summary.waitingForUser) {
				throw new Error("Stop the Hermes session's active turn before deleting it");
			}
			this.assertLocallyIdle(this.bindingFor(runtime, durableSessionId, profileId));

			await runtime.rest.deleteSession(durableSessionId, profileId);
			let reconciliationRequired = false;
			try {
				this.cleanupDeletedSession(
					connectionId,
					runtime,
					durableSessionId,
					profileId,
					relatedSessionIds
				);
			} catch (error) {
				reconciliationRequired = true;
				this.pushRuntimeError(connectionId, error, durableSessionId, profileId);
			}
			let catalog: HermesCatalog | null = null;
			try {
				catalog = await this.refreshCatalog(runtime);
			} catch (error) {
				reconciliationRequired = true;
				this.pushRuntimeError(connectionId, error, durableSessionId, profileId);
			}
			return { committed: true, catalog, reconciliationRequired };
		} finally {
			this.releaseSubmitReservation(connectionId, deletionReservation);
		}
	}

	async origin(
		connectionId: string,
		hermesSessionId: string,
		requestedProfileId?: string
	): Promise<HermesOriginProjection> {
		const runtime = this.requireRuntime(connectionId);
		try {
			const resolved = await this.resolveOrigin(
				connectionId,
				runtime,
				hermesSessionId,
				requestedProfileId
			);
			if (resolved) return resolved.projection;
		} catch {
			// Origin controls are optional and must never make stock chat/history unavailable.
		}
		const durableSessionId = this.resolveDurableId(runtime, hermesSessionId, requestedProfileId);
		const summary = runtime.catalog.sessions.find(
			(session) =>
				session.id === durableSessionId &&
				(requestedProfileId === undefined || session.profileId === requestedProfileId)
		);
		return (
			summary?.origin ?? {
				platform: summary?.source ?? "unknown",
				source: summary?.source ?? "unknown",
				displayLabel: summary?.source ?? null,
				workspaceLabel: null,
				accountLabel: null,
				chatLabel: null,
				channelLabel: null,
				threadLabel: null,
				hasThread: false,
				canOpenThread: false,
				canReport: false,
			}
		);
	}

	async originOpenUrl(
		connectionId: string,
		hermesSessionId: string,
		requestedProfileId?: string
	): Promise<string> {
		const runtime = this.requireRuntime(connectionId);
		const resolved = await this.resolveOrigin(
			connectionId,
			runtime,
			hermesSessionId,
			requestedProfileId
		);
		if (!resolved?.projection.canOpenThread || !resolved.openUrl) {
			throw new Error("This Hermes origin cannot be opened");
		}
		return resolved.openUrl;
	}

	async saveOriginLink(
		connectionId: string,
		hermesSessionId: string,
		openUrl: string,
		requestedProfileId?: string
	): Promise<HermesOriginProjection> {
		const runtime = this.requireRuntime(connectionId);
		const durableSessionId = this.resolveDurableId(runtime, hermesSessionId, requestedProfileId);
		const profileId = requestedProfileId ?? this.profileFor(runtime, durableSessionId);
		const base = await this.resolveOrigin(
			connectionId,
			runtime,
			durableSessionId,
			profileId,
			false
		);
		if (!base || base.projection.platform !== "slack") {
			throw new Error("Only Slack-origin sessions support a manual thread URL");
		}
		saveHermesOriginLink({
			connectionId,
			profileId,
			hermesSessionId: durableSessionId,
			originFingerprint: base.originFingerprint,
			openUrl,
		});
		const resolved = await this.resolveOrigin(
			connectionId,
			runtime,
			durableSessionId,
			profileId,
			true
		);
		if (!resolved) throw new Error("The Slack origin is unavailable");
		return resolved.projection;
	}

	async reportToOrigin(input: {
		connectionId: string;
		hermesSessionId: string;
		profileId?: string;
		messageId: string;
		explicitRetry: boolean;
	}): Promise<HermesOriginReportState> {
		const runtime = this.requireRuntime(input.connectionId);
		const durableSessionId = this.resolveDurableId(runtime, input.hermesSessionId, input.profileId);
		const profileId = input.profileId ?? this.profileFor(runtime, durableSessionId);
		const resolved = await this.resolveOrigin(
			input.connectionId,
			runtime,
			durableSessionId,
			profileId
		);
		if (!resolved?.projection.canReport || !resolved.target) {
			throw new Error("Slack reporting is unavailable for this session");
		}
		const history = await this.history(input.connectionId, durableSessionId, profileId);
		const message = history.messages.find(
			(candidate) => candidate.id === input.messageId && candidate.role === "assistant"
		);
		if (
			!message ||
			!message.text.trim() ||
			["cancelled", "failed", "interrupted", "error"].includes(message.status?.toLowerCase() ?? "")
		) {
			throw new Error("Select a completed assistant message from canonical Hermes history");
		}
		const identity = {
			connectionId: input.connectionId,
			profileId,
			hermesSessionId: history.durableSessionId,
			messageId: message.id,
			content: message.text,
			destinationFingerprint: resolved.originFingerprint,
		};
		prepareHermesOriginReport(identity);
		const attempt = beginHermesOriginReportAttempt({
			...identity,
			explicitRetry: input.explicitRetry,
		});
		if (!attempt.shouldSend) return attempt.state;
		try {
			const result = await this.sendService.send({
				profileId,
				target: resolved.target,
				content: message.text,
			});
			return finishHermesOriginReport({
				...identity,
				status: "sent",
				retryable: false,
				providerMessageId: result.providerMessageId,
			});
		} catch (error) {
			const sendError =
				error instanceof HermesSendError
					? error
					: new HermesSendError("The stock Hermes sender failed", "process-failed", true);
			return finishHermesOriginReport({
				...identity,
				status: "failed",
				retryable: sendError.retryable,
				errorCode: sendError.code,
			});
		}
	}

	reports(
		connectionId: string,
		hermesSessionId: string,
		requestedProfileId?: string
	): HermesOriginReportState[] {
		const runtime = this.requireRuntime(connectionId);
		const durableSessionId = this.resolveDurableId(runtime, hermesSessionId, requestedProfileId);
		return listHermesOriginReports(
			connectionId,
			requestedProfileId ?? this.profileFor(runtime, durableSessionId),
			durableSessionId
		);
	}

	async history(
		connectionId: string,
		hermesSessionId: string,
		requestedProfileId?: string
	): Promise<HermesSessionHistory> {
		const runtime = this.requireRuntime(connectionId);
		const durableSessionId = this.resolveDurableId(runtime, hermesSessionId, requestedProfileId);
		const profileId = requestedProfileId ?? this.profileFor(runtime, durableSessionId);
		const durableKey = hermesSessionIdentityKey(profileId, durableSessionId);
		const draftBinding = this.bindingFor(runtime, durableSessionId, profileId);
		if (draftBinding && !draftBinding.persisted) {
			return (
				runtime.histories.get(durableKey) ?? {
					durableSessionId,
					view: "active",
					messages: [],
				}
			);
		}
		const cached =
			runtime.histories.get(hermesSessionIdentityKey(profileId, hermesSessionId)) ??
			runtime.histories.get(durableKey);
		const history = reconcileHermesHistory(
			cached,
			await runtime.rest.getTranscript(durableSessionId, profileId)
		);
		if (draftBinding) draftBinding.persisted = true;
		if (history.durableSessionId !== durableSessionId) {
			runtime.aliases.set(
				hermesSessionIdentityKey(profileId, hermesSessionId),
				history.durableSessionId
			);
			runtime.aliases.set(durableKey, history.durableSessionId);
			canonicalizeHermesWorkspaceLinks(
				connectionId,
				[hermesSessionId, durableSessionId],
				history.durableSessionId
			);
		}
		runtime.histories.set(hermesSessionIdentityKey(profileId, hermesSessionId), history);
		runtime.histories.set(durableKey, history);
		runtime.histories.set(hermesSessionIdentityKey(profileId, history.durableSessionId), history);
		this.reconcileFollowUpsFromHistory(connectionId, profileId, history);
		this.linkArtifacts(
			connectionId,
			history.durableSessionId,
			history.messages.flatMap((message) => message.workspaceArtifacts)
		);
		return history;
	}

	async create(
		connectionId: string,
		input: { initialPrompt: string; profileId?: string }
	): Promise<HermesSessionBinding> {
		const runtime = this.requireRuntime(connectionId);
		const profileId = input.profileId ?? runtime.profileId;
		if (!runtime.managerId) {
			throw new Error("Hermes manager ownership is unavailable for this Agents session");
		}
		const params: Record<string, unknown> = {
			title: sessionTitleFromTopic(input.initialPrompt),
			source: "superiorswarm",
			profile: profileId,
		};
		const binding = normalizeHermesSessionBinding(
			await runtime.client.request("session.create", params),
			undefined,
			profileId
		);
		admitHermesSession({
			managerId: runtime.managerId,
			metadata: {
				schemaVersion: 1,
				durableSessionId: binding.durableSessionId,
				profileId: binding.profileId,
				sourcePlatform: "superiorswarm",
				isCron: false,
			},
			reason: "agents",
		});
		this.installBinding(runtime, binding);
		runtime.histories.set(hermesSessionIdentityKey(binding.profileId, binding.durableSessionId), {
			durableSessionId: binding.durableSessionId,
			view: "active",
			messages: [
				{
					id: `draft-${binding.durableSessionId}`,
					canonicalMessageId: null,
					compactionGeneration: null,
					active: null,
					compacted: null,
					displayKind: null,
					compactionSummaryType: null,
					turnId: null,
					role: "user",
					text: input.initialPrompt,
					createdAt: Date.now(),
					status: "submitting",
					toolName: null,
					workspaceArtifacts: [],
				},
			],
		});
		void this.submit(
			connectionId,
			binding.durableSessionId,
			input.initialPrompt,
			[],
			binding.profileId
		).catch((error) => {
			this.pushRuntimeError(connectionId, error, binding.durableSessionId, binding.profileId);
		});
		return binding;
	}

	async resume(
		connectionId: string,
		hermesSessionId: string,
		requestedProfileId?: string
	): Promise<
		HermesSessionBinding & {
			history: HermesSessionHistory;
			activeTurnSnapshot: HermesActiveTurnSnapshot;
		}
	> {
		const runtime = this.requireRuntime(connectionId);
		if (runtime.reconnectTask) await runtime.reconnectTask;
		const history = await this.history(connectionId, hermesSessionId, requestedProfileId);
		const durableSessionId = history.durableSessionId;
		const profileId = requestedProfileId ?? this.profileFor(runtime, durableSessionId);
		const existing = this.bindingFor(runtime, durableSessionId, profileId);
		if (existing) {
			try {
				const response = await runtime.client.request("session.activate", {
					session_id: existing.runtimeSessionId,
					omit_messages: false,
				});
				const activated = normalizeHermesSessionBinding(
					response,
					durableSessionId,
					existing.profileId
				);
				const activity = normalizeHermesRuntimeActivity(response);
				const installed = this.installBinding(runtime, activated, activity);
				this.captureActiveTurnSnapshot(runtime, installed, response);
				this.reconcileUncertainFollowUp(runtime, installed, response);
				return { ...installed, history };
			} catch {
				this.removeBinding(runtime, existing);
			}
		}
		const binding = await this.resumeBinding(runtime, durableSessionId, profileId);
		return { ...binding, history };
	}

	async submit(
		connectionId: string,
		hermesSessionId: string,
		text: string,
		attachmentHandles: string[] = [],
		requestedProfileId?: string
	): Promise<{ ok: true }> {
		await this.submitFollowUp(
			connectionId,
			hermesSessionId,
			text,
			attachmentHandles,
			requestedProfileId
		);
		return { ok: true };
	}

	async submitFollowUp(
		connectionId: string,
		hermesSessionId: string,
		text: string,
		attachmentHandles: string[] = [],
		requestedProfileId?: string
	): Promise<{
		ok: true;
		disposition: "submitted" | "queued";
		followUp: HermesQueuedFollowUpSummary;
	}> {
		const identity = this.followUpIdentity(connectionId, hermesSessionId, requestedProfileId);
		const queue = this.ensureFollowUpQueue(identity);
		const admissionGeneration = queue.generation;
		const releaseAdmission = await this.acquireQueueAdmission(queue);
		let followUp: QueuedFollowUp;
		let shouldDrain = false;
		try {
			this.assertQueueCurrent(queue, admissionGeneration);
			const retryable = queue.items.find(
				(candidate) =>
					candidate.status === "failed" &&
					candidate.text === text &&
					this.sameHandles(candidate.attachmentHandles, attachmentHandles)
			);
			if (retryable) {
				if (retryable.transportUncertain) {
					throw new Error("Reconnect and wait for Hermes to confirm delivery before retrying");
				}
				retryable.status = "queued";
				retryable.error = null;
				retryable.transportUncertain = false;
				followUp = retryable;
			} else {
				const id = this.followUpIdFactory();
				const metadata = await this.attachmentStore.claim(attachmentHandles, id);
				if (!this.isQueueCurrent(queue, admissionGeneration)) {
					this.attachmentStore.releaseClaim(attachmentHandles, id);
					throw connectionCancelledError();
				}
				const runtime = this.runtimes.get(connectionId);
				const binding = runtime
					? this.bindingFor(runtime, identity.durableSessionId, identity.profileId)
					: null;
				const wasQueued =
					!runtime ||
					binding?.activeTurn === true ||
					queue.active !== null ||
					queue.items.length > 0 ||
					queue.draining !== null;
				followUp = {
					id,
					durableSessionId: identity.durableSessionId,
					profileId: identity.profileId,
					text,
					attachments: metadata.map(({ kind, name }) => ({ kind, name })),
					knownCanonicalUserMessageIds: this.canonicalUserMessageIds(
						connectionId,
						identity.profileId,
						identity.durableSessionId
					),
					status: "queued",
					error: null,
					createdAt: this.now(),
					attachmentHandles: [...attachmentHandles],
					ownerId: id,
					wasQueued,
					transportUncertain: false,
					deliveryKey: id,
					deliveryTurnId: null,
					submittedPromptText: null,
				};
				queue.items.push(followUp);
			}
			const runtime = this.runtimes.get(connectionId);
			const binding = runtime
				? this.bindingFor(runtime, identity.durableSessionId, identity.profileId)
				: null;
			if (binding?.activeTurn && queue.activeTurnGeneration === null) {
				queue.activeTurnGeneration =
					binding.activeTurnIdentity?.generation ?? binding.turnGeneration;
			}
			shouldDrain = Boolean(runtime && !binding?.activeTurn && queue.active === null);
			this.pushFollowUpQueueEvent(queue);
		} finally {
			releaseAdmission();
			this.removeEmptyFollowUpQueue(queue);
		}

		if (shouldDrain) await this.drainFollowUpQueue(queue);
		return {
			ok: true,
			disposition: followUp.wasQueued ? "queued" : "submitted",
			followUp: this.followUpSummary(followUp),
		};
	}

	followUps(
		connectionId: string,
		hermesSessionId: string,
		requestedProfileId?: string
	): HermesQueuedFollowUpSummary[] {
		const identity = this.followUpIdentity(connectionId, hermesSessionId, requestedProfileId);
		const queue = this.followUpQueues.get(
			hermesSessionCompositeIdentityKey(
				identity.connectionId,
				identity.profileId,
				identity.durableSessionId
			)
		);
		return queue ? this.queueSummaries(queue) : [];
	}

	async retryFollowUp(
		connectionId: string,
		hermesSessionId: string,
		followUpId: string,
		requestedProfileId?: string
	): Promise<{ ok: true; followUp: HermesQueuedFollowUpSummary }> {
		const queue = this.requireFollowUpQueue(
			this.followUpIdentity(connectionId, hermesSessionId, requestedProfileId)
		);
		const followUp = queue.items.find((candidate) => candidate.id === followUpId);
		if (!followUp || followUp.status !== "failed") {
			throw new Error("The queued follow-up is not retryable");
		}
		if (followUp.transportUncertain) {
			throw new Error("Reconnect and wait for Hermes to confirm delivery before retrying");
		}
		followUp.status = "queued";
		followUp.error = null;
		followUp.transportUncertain = false;
		this.pushFollowUpQueueEvent(queue);
		await this.drainFollowUpQueue(queue);
		return { ok: true, followUp: this.followUpSummary(followUp) };
	}

	cancelFollowUp(
		connectionId: string,
		hermesSessionId: string,
		followUpId: string,
		requestedProfileId?: string
	): { ok: true } {
		const queue = this.requireFollowUpQueue(
			this.followUpIdentity(connectionId, hermesSessionId, requestedProfileId)
		);
		const index = queue.items.findIndex((candidate) => candidate.id === followUpId);
		const followUp = queue.items[index];
		if (!followUp || followUp.status === "submitting") {
			throw new Error("The queued follow-up can no longer be cancelled");
		}
		queue.items.splice(index, 1);
		this.attachmentStore.releaseClaim(followUp.attachmentHandles, followUp.ownerId);
		this.pushFollowUpQueueEvent(queue);
		this.removeEmptyFollowUpQueue(queue);
		const runtime = this.runtimes.get(connectionId);
		const binding = runtime
			? this.bindingFor(runtime, queue.durableSessionId, queue.profileId)
			: null;
		if (runtime && !binding?.activeTurn && !queue.active) {
			this.drainFollowUpQueueInBackground(queue);
		}
		return { ok: true };
	}

	async interrupt(
		connectionId: string,
		hermesSessionId: string,
		profileId?: string
	): Promise<{ ok: true }> {
		const runtime = this.requireRuntime(connectionId);
		const binding = this.requireBinding(runtime, hermesSessionId, profileId);
		await runtime.client.request("session.interrupt", {
			session_id: binding.runtimeSessionId,
		});
		binding.activeTurn = false;
		this.clearPendingInteractions(binding);
		return { ok: true };
	}

	async respondToApproval(input: {
		connectionId: string;
		hermesSessionId: string;
		profileId?: string;
		requestId: string;
		choice: string;
	}): Promise<{ ok: true }> {
		const runtime = this.requireRuntime(input.connectionId);
		const binding = this.requireBinding(runtime, input.hermesSessionId, input.profileId);
		await runtime.client.request("approval.respond", {
			session_id: binding.runtimeSessionId,
			request_id: input.requestId,
			choice: input.choice,
		});
		this.clearPendingInteraction(binding, "approval", input.requestId);
		return { ok: true };
	}

	async respondToClarification(input: {
		connectionId: string;
		hermesSessionId: string;
		profileId?: string;
		requestId: string;
		answer: string;
	}): Promise<{ ok: true }> {
		const runtime = this.requireRuntime(input.connectionId);
		const binding = this.requireBinding(runtime, input.hermesSessionId, input.profileId);
		await runtime.client.request("clarify.respond", {
			session_id: binding.runtimeSessionId,
			request_id: input.requestId,
			answer: input.answer,
		});
		this.clearPendingInteraction(binding, "clarification", input.requestId);
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
		if (this.closed) return;
		this.closed = true;
		this.unsubscribeBackendInvalidation();
		const connectionIds = new Set([...this.runtimes.keys(), ...this.connectionOperations.keys()]);
		for (const connectionId of connectionIds) this.disconnect(connectionId);
		this.connectionStates.clear();
		this.submitReservations.clear();
		this.followUpQueues.clear();
		this.attachmentStore.clear();
		this.localBackendManager.shutdown();
	}

	private followUpIdentity(
		connectionId: string,
		hermesSessionId: string,
		requestedProfileId?: string
	): { connectionId: string; profileId: string; durableSessionId: string } {
		const runtime = this.runtimes.get(connectionId);
		if (runtime) {
			const durableSessionId = this.resolveDurableId(runtime, hermesSessionId, requestedProfileId);
			return {
				connectionId,
				profileId: requestedProfileId ?? this.profileFor(runtime, durableSessionId),
				durableSessionId,
			};
		}
		const connection = listHermesConnections().find((candidate) => candidate.id === connectionId);
		if (!connection) throw new Error("Hermes connection is unavailable");
		return {
			connectionId,
			profileId: requestedProfileId ?? connection.profileId,
			durableSessionId: hermesSessionId,
		};
	}

	private canonicalUserMessageIds(
		connectionId: string,
		profileId: string,
		durableSessionId: string
	): string[] {
		const history = this.runtimes
			.get(connectionId)
			?.histories.get(hermesSessionIdentityKey(profileId, durableSessionId));
		return (
			history?.messages
				.filter((message) => message.role === "user")
				.map((message) => message.canonicalMessageId ?? message.id) ?? []
		);
	}

	private ensureFollowUpQueue(identity: {
		connectionId: string;
		profileId: string;
		durableSessionId: string;
	}): SessionFollowUpQueue {
		const key = hermesSessionCompositeIdentityKey(
			identity.connectionId,
			identity.profileId,
			identity.durableSessionId
		);
		let queue = this.followUpQueues.get(key);
		if (!queue) {
			queue = {
				...identity,
				items: [],
				active: null,
				settled: [],
				draining: null,
				admissionTail: Promise.resolve(),
				admissions: 0,
				generation: 0,
				valid: true,
				activeTurnGeneration: null,
			};
			this.followUpQueues.set(key, queue);
		}
		return queue;
	}

	private requireFollowUpQueue(identity: {
		connectionId: string;
		profileId: string;
		durableSessionId: string;
	}): SessionFollowUpQueue {
		const queue = this.followUpQueues.get(
			hermesSessionCompositeIdentityKey(
				identity.connectionId,
				identity.profileId,
				identity.durableSessionId
			)
		);
		if (!queue) throw new Error("The queued follow-up is unavailable");
		return queue;
	}

	private async acquireQueueAdmission(queue: SessionFollowUpQueue): Promise<() => void> {
		queue.admissions++;
		const previous = queue.admissionTail;
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		queue.admissionTail = previous.then(() => gate);
		await previous;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			queue.admissions--;
			release();
		};
	}

	private isQueueCurrent(queue: SessionFollowUpQueue, generation = queue.generation): boolean {
		return (
			queue.valid &&
			queue.generation === generation &&
			this.followUpQueues.get(
				hermesSessionCompositeIdentityKey(
					queue.connectionId,
					queue.profileId,
					queue.durableSessionId
				)
			) === queue
		);
	}

	private assertQueueCurrent(queue: SessionFollowUpQueue, generation = queue.generation): void {
		if (!this.isQueueCurrent(queue, generation)) throw connectionCancelledError();
	}

	private sameHandles(left: string[], right: string[]): boolean {
		return left.length === right.length && left.every((handle, index) => handle === right[index]);
	}

	private followUpSummary(followUp: QueuedFollowUp): HermesQueuedFollowUpSummary {
		return {
			id: followUp.id,
			durableSessionId: followUp.durableSessionId,
			profileId: followUp.profileId,
			text: followUp.text,
			attachments: followUp.attachments.map((attachment) => ({ ...attachment })),
			knownCanonicalUserMessageIds: [...followUp.knownCanonicalUserMessageIds],
			status: followUp.status,
			error: followUp.error,
			createdAt: followUp.createdAt,
		};
	}

	private queueSummaries(queue: SessionFollowUpQueue): HermesQueuedFollowUpSummary[] {
		queue.settled = queue.settled.filter((followUp) => !this.hasCanonicalFollowUp(queue, followUp));
		return [
			...queue.settled.map((followUp) => this.followUpSummary(followUp)),
			...(queue.active?.wasQueued && !this.hasCanonicalFollowUp(queue, queue.active)
				? [this.followUpSummary(queue.active)]
				: []),
			...queue.items.map((followUp) => this.followUpSummary(followUp)),
		];
	}

	private hasCanonicalFollowUp(queue: SessionFollowUpQueue, followUp: QueuedFollowUp): boolean {
		const history = this.runtimes
			.get(queue.connectionId)
			?.histories.get(hermesSessionIdentityKey(queue.profileId, queue.durableSessionId));
		if (!history) return false;
		const knownIds = new Set(followUp.knownCanonicalUserMessageIds);
		return history.messages.some((message) => {
			if (message.role !== "user") return false;
			const identity = message.canonicalMessageId ?? message.id;
			if (knownIds.has(identity)) return false;
			return (
				message.text === followUp.text ||
				(followUp.submittedPromptText !== null && message.text === followUp.submittedPromptText)
			);
		});
	}

	private addSettledFollowUp(queue: SessionFollowUpQueue, followUp: QueuedFollowUp): void {
		if (!queue.settled.some((candidate) => candidate.id === followUp.id)) {
			queue.settled.push(followUp);
		}
		if (queue.settled.length > MAX_ACCEPTED_FOLLOW_UP_LEDGER) {
			queue.settled.splice(0, queue.settled.length - MAX_ACCEPTED_FOLLOW_UP_LEDGER);
		}
	}

	private queueSummariesForBinding(
		runtime: ConnectionRuntime,
		binding: Pick<HermesSessionBinding, "durableSessionId" | "profileId">
	): HermesQueuedFollowUpSummary[] {
		const connectionId = [...this.runtimes].find(([, candidate]) => candidate === runtime)?.[0];
		if (!connectionId) return [];
		const queue = this.followUpQueues.get(
			hermesSessionCompositeIdentityKey(connectionId, binding.profileId, binding.durableSessionId)
		);
		return queue ? this.queueSummaries(queue) : [];
	}

	private connectionQueueSummaries(connectionId: string): HermesQueuedFollowUpRuntimeSummary[] {
		return [...this.followUpQueues.values()].flatMap((queue) => {
			if (queue.connectionId !== connectionId) return [];
			const summaries = this.queueSummaries(queue).filter(
				(followUp) => followUp.status !== "accepted"
			);
			if (summaries.length === 0) return [];
			return [
				{
					durableSessionId: queue.durableSessionId,
					profileId: queue.profileId,
					queuedCount: summaries.filter((followUp) => followUp.status !== "failed").length,
					failedCount: summaries.filter((followUp) => followUp.status === "failed").length,
				},
			];
		});
	}

	private pushFollowUpQueueEvent(queue: SessionFollowUpQueue): void {
		const runtime = this.runtimes.get(queue.connectionId);
		if (!runtime) return;
		const binding = this.bindingFor(runtime, queue.durableSessionId, queue.profileId);
		if (binding) binding.activeTurnSnapshot.queuedFollowUps = this.queueSummaries(queue);
		this.pushEvent(queue.connectionId, {
			type: "runtime.follow-up-queue",
			profileId: queue.profileId,
			runtimeSessionId: binding?.runtimeSessionId ?? null,
			durableSessionId: queue.durableSessionId,
			turnId: binding?.activeTurnSnapshot.turnId ?? null,
			requestId: null,
			text: null,
			toolName: null,
			status: null,
			payload: { queuedFollowUps: this.queueSummaries(queue) },
			workspaceArtifacts: [],
			receivedAt: Date.now(),
		});
	}

	private removeEmptyFollowUpQueue(queue: SessionFollowUpQueue): void {
		if (
			!queue.valid ||
			queue.active ||
			queue.activeTurnGeneration !== null ||
			queue.settled.length > 0 ||
			queue.items.length > 0 ||
			queue.draining ||
			queue.admissions > 0
		) {
			return;
		}
		this.followUpQueues.delete(
			hermesSessionCompositeIdentityKey(queue.connectionId, queue.profileId, queue.durableSessionId)
		);
	}

	private async drainFollowUpQueue(queue: SessionFollowUpQueue): Promise<void> {
		if (queue.draining) return await queue.draining;
		const task = this.performFollowUpDrain(queue);
		queue.draining = task;
		try {
			await task;
		} finally {
			if (queue.draining === task) queue.draining = null;
			this.removeEmptyFollowUpQueue(queue);
			const runtime = this.runtimes.get(queue.connectionId);
			const binding = runtime
				? this.bindingFor(runtime, queue.durableSessionId, queue.profileId)
				: null;
			if (runtime && !binding?.activeTurn && !queue.active && queue.items[0]?.status === "queued") {
				this.drainFollowUpQueueInBackground(queue);
			}
		}
	}

	private drainFollowUpQueueInBackground(queue: SessionFollowUpQueue): void {
		void this.drainFollowUpQueue(queue).catch((error) => {
			this.pushRuntimeError(queue.connectionId, error, queue.durableSessionId, queue.profileId);
		});
	}

	private async performFollowUpDrain(queue: SessionFollowUpQueue): Promise<void> {
		const queueGeneration = queue.generation;
		this.assertQueueCurrent(queue, queueGeneration);
		const runtime = this.runtimes.get(queue.connectionId);
		if (!runtime) return;
		if (runtime.reconnectTask) await runtime.reconnectTask;
		if (
			this.runtimes.get(queue.connectionId) !== runtime ||
			!this.isQueueCurrent(queue, queueGeneration)
		)
			return;
		let binding = this.bindingFor(runtime, queue.durableSessionId, queue.profileId);
		if (!binding) {
			await this.resume(queue.connectionId, queue.durableSessionId, queue.profileId);
			this.assertQueueCurrent(queue, queueGeneration);
			binding = this.requireBinding(runtime, queue.durableSessionId, queue.profileId);
		}
		const followUp = queue.items[0];
		if (!followUp || followUp.status !== "queued") return;
		if (binding.activeTurn || queue.active) {
			followUp.wasQueued = true;
			return;
		}

		followUp.status = "submitting";
		followUp.error = null;
		binding.activeTurn = true;
		binding.activeTurnSnapshot.activeTurn = true;
		binding.activeTurnSnapshot.status = "submitting";
		binding.activeTurnSnapshot.turnId = null;
		binding.turnGeneration++;
		const turnGeneration = binding.turnGeneration;
		binding.activeTurnIdentity = {
			generation: turnGeneration,
			runtimeSessionId: binding.runtimeSessionId,
			turnId: null,
		};
		queue.activeTurnGeneration = turnGeneration;
		this.clearPendingInteractions(binding);
		this.pushFollowUpQueueEvent(queue);
		try {
			const attachments = await this.attachmentStore.resolve(followUp.attachmentHandles);
			this.assertQueueCurrent(queue, queueGeneration);
			const attached = [];
			for (const attachment of attachments) {
				const result = await this.attachFile(runtime, binding, attachment);
				this.assertQueueCurrent(queue, queueGeneration);
				attached.push({
					kind: attachment.kind,
					name: attachment.name,
					refText: result.refText,
				});
			}
			followUp.submittedPromptText = buildHermesAttachmentPromptText(followUp.text, attached);
			const response = await runtime.client.request(
				"prompt.submit",
				{
					session_id: binding.runtimeSessionId,
					text: followUp.submittedPromptText,
					idempotency_key: followUp.deliveryKey,
				},
				{ timeoutMs: PROMPT_SUBMIT_TIMEOUT_MS }
			);
			if (
				this.runtimes.get(queue.connectionId) !== runtime ||
				!this.isQueueCurrent(queue, queueGeneration)
			)
				return;
			followUp.deliveryTurnId = responseTurnId(response);
			if (binding.activeTurnIdentity?.generation === turnGeneration && followUp.deliveryTurnId) {
				binding.activeTurnIdentity.turnId = followUp.deliveryTurnId;
				binding.activeTurnSnapshot.turnId = followUp.deliveryTurnId;
			}
			queue.items.shift();
			followUp.status = "accepted";
			followUp.transportUncertain = false;
			if (followUp.wasQueued) {
				if (binding.activeTurn) queue.active = followUp;
				else this.addSettledFollowUp(queue, followUp);
			}
			this.attachmentStore.releaseClaim(followUp.attachmentHandles, followUp.ownerId);
			this.pushFollowUpQueueEvent(queue);
			this.processPendingTerminalEvents(queue.connectionId, runtime, binding);
		} catch (error) {
			if (
				this.runtimes.get(queue.connectionId) !== runtime ||
				!this.isQueueCurrent(queue, queueGeneration)
			)
				return;
			binding.activeTurn = false;
			binding.activeTurnSnapshot.activeTurn = false;
			binding.activeTurnSnapshot.turnId = null;
			if (binding.activeTurnIdentity?.generation === turnGeneration) {
				binding.activeTurnIdentity = null;
			}
			if (queue.activeTurnGeneration === turnGeneration) queue.activeTurnGeneration = null;
			followUp.status = "failed";
			followUp.transportUncertain = false;
			const sanitized = sanitizeHermesPayload(
				error instanceof Error ? error.message : "Hermes follow-up failed"
			);
			followUp.error = typeof sanitized === "string" ? sanitized : "Hermes follow-up failed";
			this.pushFollowUpQueueEvent(queue);
			throw new Error(followUp.error);
		}
	}

	private drainConnectionFollowUps(connectionId: string): void {
		for (const queue of this.followUpQueues.values()) {
			if (queue.connectionId === connectionId) this.drainFollowUpQueueInBackground(queue);
		}
	}

	private async attachFile(
		runtime: ConnectionRuntime,
		binding: RuntimeBinding,
		attachment: HermesResolvedAttachment
	): Promise<HermesAttachedResult> {
		const cached = this.attachmentStore.attachedResult(attachment.handle, binding.runtimeSessionId);
		if (cached) return cached;
		try {
			let response: unknown;
			if (attachment.kind === "image") {
				response =
					runtime.connectionMode === "remote"
						? await runtime.client.request("image.attach_bytes", {
								session_id: binding.runtimeSessionId,
								content_base64: (await this.attachmentStore.readBytes(attachment.handle)).toString(
									"base64"
								),
								filename: attachment.name,
							})
						: await runtime.client.request("image.attach", {
								session_id: binding.runtimeSessionId,
								path: attachment.path,
							});
				this.assertAttachmentResponse(response, false);
			} else if (attachment.kind === "pdf") {
				response = await runtime.client.request("pdf.attach", {
					session_id: binding.runtimeSessionId,
					...(runtime.connectionMode === "remote"
						? {
								content_base64: (await this.attachmentStore.readBytes(attachment.handle)).toString(
									"base64"
								),
								filename: attachment.name,
							}
						: { path: attachment.path }),
					first_page: 1,
					last_page: 25,
				});
				this.assertAttachmentResponse(response, false);
			} else {
				response = await runtime.client.request("file.attach", {
					session_id: binding.runtimeSessionId,
					...(runtime.connectionMode === "remote"
						? {
								data_url: `data:${attachment.mimeType};base64,${(
									await this.attachmentStore.readBytes(attachment.handle)
								).toString("base64")}`,
							}
						: { path: attachment.path }),
					name: attachment.name,
				});
				this.assertAttachmentResponse(response, true);
			}
			const values =
				response !== null && typeof response === "object"
					? (response as Record<string, unknown>)
					: {};
			const refText =
				attachment.kind === "file" && isSafeHermesFileReference(values["ref_text"])
					? values["ref_text"]
					: null;
			const result = { contextText: refText ?? attachment.name, refText };
			this.attachmentStore.markAttached(attachment.handle, binding.runtimeSessionId, result);
			return result;
		} catch (error) {
			const safeMessage =
				error instanceof HermesAttachmentRpcError
					? error.message
					: "Hermes rejected the attachment";
			throw new Error(`Could not attach “${attachment.name}”: ${safeMessage}`);
		}
	}

	private assertAttachmentResponse(response: unknown, requireRef: boolean): void {
		const values =
			response !== null && typeof response === "object"
				? (response as Record<string, unknown>)
				: null;
		const refText = values?.["ref_text"];
		const validRef = isSafeHermesFileReference(refText);
		if (values?.["attached"] === true && (!requireRef || validRef)) {
			return;
		}
		const message =
			values?.["attached"] === true && requireRef
				? "Hermes did not return a valid @file reference"
				: "Hermes rejected the attachment";
		throw new HermesAttachmentRpcError(message);
	}

	private reserveSubmit(
		runtime: ConnectionRuntime,
		connectionId: string,
		hermesSessionId: string,
		profileId?: string
	): Set<string> {
		const durableSessionId = this.resolveDurableId(runtime, hermesSessionId, profileId);
		const resolvedProfileId = profileId ?? this.profileFor(runtime, durableSessionId);
		const reservationKey = hermesSessionIdentityKey(resolvedProfileId, durableSessionId);
		let reservations = this.submitReservations.get(connectionId);
		if (!reservations) {
			reservations = new Set();
			this.submitReservations.set(connectionId, reservations);
		}
		if (reservations.has(reservationKey)) {
			throw new Error("A Hermes turn is already active for this session");
		}
		reservations.add(reservationKey);
		return new Set([reservationKey]);
	}

	private releaseSubmitReservation(connectionId: string, reservedSessionIds: Set<string>): void {
		const reservations = this.submitReservations.get(connectionId);
		if (!reservations) return;
		for (const sessionId of reservedSessionIds) reservations.delete(sessionId);
		if (reservations.size === 0) this.submitReservations.delete(connectionId);
	}

	private beginConnectionOperation(
		connectionId: string,
		preserveRuntime: boolean
	): ConnectionOperation {
		const previousOperation = this.connectionOperations.get(connectionId);
		const previousRuntime = preserveRuntime
			? (this.runtimes.get(connectionId) ?? previousOperation?.previousRuntime ?? null)
			: null;
		this.invalidateConnectionOperation(connectionId);
		this.disposeInstalledRuntime(connectionId);
		const operation: ConnectionOperation = {
			generation: this.connectionGenerations.get(connectionId) ?? 0,
			controller: new AbortController(),
			managementMode: null,
			managedProfileId: null,
			managedBaseUrl: null,
			previousRuntime,
		};
		this.connectionOperations.set(connectionId, operation);
		return operation;
	}

	private invalidateConnectionOperation(connectionId: string): void {
		const operation = this.connectionOperations.get(connectionId);
		this.connectionOperations.delete(connectionId);
		operation?.controller.abort();
		this.connectionGenerations.set(
			connectionId,
			(this.connectionGenerations.get(connectionId) ?? 0) + 1
		);
	}

	private finishConnectionOperation(connectionId: string, operation: ConnectionOperation): void {
		if (this.connectionOperations.get(connectionId) === operation) {
			this.connectionOperations.delete(connectionId);
		}
	}

	private isCurrentOperation(connectionId: string, operation: ConnectionOperation): boolean {
		return (
			!this.closed &&
			!operation.controller.signal.aborted &&
			this.connectionGenerations.get(connectionId) === operation.generation &&
			this.connectionOperations.get(connectionId) === operation
		);
	}

	private assertCurrentOperation(connectionId: string, operation: ConnectionOperation): void {
		if (!this.isCurrentOperation(connectionId, operation)) throw connectionCancelledError();
	}

	private async establishConnection(
		connectionId: string,
		operation: ConnectionOperation
	): Promise<HermesCatalog> {
		this.assertCurrentOperation(connectionId, operation);
		const summary = listHermesConnections(this.tokenVault).find(
			(connection) => connection.id === connectionId
		);
		if (!summary) throw new Error("Hermes connection was not found");
		operation.managementMode = summary.managementMode;
		operation.managedProfileId = summary.managementMode === "managed" ? summary.profileId : null;

		let resolvedBaseUrl: string;
		let resolvedProfileId = summary.profileId;
		let resolvedToken: string;
		let resolvedManagerId = summary.managerId;
		if (summary.managementMode === "managed") {
			const managed = await abortable(
				this.localBackendManager.ensure(summary.profileId),
				operation.controller.signal
			);
			this.assertCurrentOperation(connectionId, operation);
			operation.managedProfileId = managed.profileId;
			operation.managedBaseUrl = managed.baseUrl;
			resolvedBaseUrl = managed.baseUrl;
			resolvedProfileId = managed.profileId;
			resolvedToken = managed.token;
			resolvedManagerId = managed.managerId ?? null;
		} else if (summary.connectionMode === "loopback") {
			if (summary.managerBindingMode !== "manual") {
				const installedManagerId = this.externalManagerIdResolver(summary);
				if (
					summary.managerBindingMode === null &&
					summary.managerId !== null &&
					installedManagerId !== summary.managerId
				) {
					throw new Error(
						"Hermes manager ownership is ambiguous; reselect the manager or auto-detection in connection settings"
					);
				}
				resolvedManagerId = installedManagerId;
				if (
					(summary.managerBindingMode === "auto" && summary.managerId !== resolvedManagerId) ||
					(summary.managerBindingMode === null && summary.managerId === null)
				) {
					setHermesConnectionAutoManagerId(summary.id, resolvedManagerId);
				}
			}
			if (!summary.baseUrl) throw new Error("External Hermes URL is unavailable");
			const token = await abortable(
				this.loopbackTokenResolver(summary.baseUrl),
				operation.controller.signal
			);
			this.assertCurrentOperation(connectionId, operation);
			saveHermesConnection(
				{
					id: summary.id,
					label: summary.label,
					baseUrl: summary.baseUrl,
					profileId: summary.profileId,
					token,
				},
				this.tokenVault
			);
			resolvedBaseUrl = summary.baseUrl;
			resolvedToken = token;
		} else {
			const external = getHermesConnectionWithToken(connectionId, this.tokenVault);
			if (!external || !external.baseUrl) {
				throw new Error("Hermes token is unavailable; enter it again to reconnect");
			}
			resolvedBaseUrl = external.baseUrl;
			resolvedToken = external.token;
		}
		this.assertCurrentOperation(connectionId, operation);

		const client = this.clientFactory();
		let clientDisposed = false;
		const disposePendingClient = () => {
			if (clientDisposed) return;
			clientDisposed = true;
			client.disconnect();
		};
		operation.controller.signal.addEventListener("abort", disposePendingClient, { once: true });
		let installedRuntime: ConnectionRuntime | null = null;
		try {
			const rest = this.restClientFactory({
				baseUrl: resolvedBaseUrl,
				profileId: resolvedProfileId,
				token: resolvedToken,
			});
			await abortable(
				client.connect({
					baseUrl: resolvedBaseUrl,
					authMode: "token",
					token: resolvedToken,
				}),
				operation.controller.signal
			);
			this.assertCurrentOperation(connectionId, operation);
			const sessions = await abortable(
				rest.listSessions(operation.controller.signal),
				operation.controller.signal
			);
			this.assertCurrentOperation(connectionId, operation);
			const previous = operation.previousRuntime;
			installedRuntime = {
				client,
				rest,
				profileId: resolvedProfileId,
				connectionMode: summary.connectionMode,
				managementMode: summary.managementMode,
				managerId: resolvedManagerId,
				managedBaseUrl: summary.managementMode === "managed" ? operation.managedBaseUrl : null,
				catalog: stockCatalog(
					sessions,
					summary.connectionMode,
					this.sendService.isAvailable(),
					resolvedManagerId
				),
				bindings: new Map(previous?.bindings),
				runtimeToDurable: new Map(previous?.runtimeToDurable),
				aliases: new Map(previous?.aliases),
				events: previous ? [...previous.events] : [],
				nextSeq: previous?.nextSeq ?? 0,
				unsubscribers: [],
				reconnectTask: null,
				histories: new Map(previous?.histories),
				origins: new Map(previous?.origins),
			};
			this.runtimes.set(connectionId, installedRuntime);
			this.bindClient(connectionId, installedRuntime);
			markHermesConnectionConnected(connectionId);
			this.connectionStates.delete(connectionId);
			operation.controller.signal.removeEventListener("abort", disposePendingClient);
			if (previous && installedRuntime.bindings.size > 0) {
				this.reconcileAfterReconnect(connectionId, installedRuntime);
			}
			return installedRuntime.catalog;
		} catch (error) {
			operation.controller.signal.removeEventListener("abort", disposePendingClient);
			if (installedRuntime && this.runtimes.get(connectionId) === installedRuntime) {
				this.disposeInstalledRuntime(connectionId);
			} else {
				disposePendingClient();
			}
			throw error;
		}
	}

	private handleBackendInvalidation(event: HermesLocalBackendInvalidation): void {
		if (this.closed) return;
		const affectedConnectionIds = new Set<string>();
		for (const [connectionId, runtime] of this.runtimes) {
			if (
				runtime.managementMode === "managed" &&
				runtime.profileId === event.profileId &&
				runtime.managedBaseUrl === event.baseUrl
			) {
				affectedConnectionIds.add(connectionId);
			}
		}
		for (const [connectionId, operation] of this.connectionOperations) {
			if (
				operation.managementMode === "managed" &&
				(operation.managedProfileId === event.profileId ||
					operation.managedProfileId === "custom") &&
				(!operation.managedBaseUrl || operation.managedBaseUrl === event.baseUrl)
			) {
				affectedConnectionIds.add(connectionId);
			}
		}
		for (const connectionId of affectedConnectionIds) {
			const operation = this.beginConnectionOperation(connectionId, true);
			this.connectionStates.set(connectionId, {
				status: "reconnecting",
				reconnectAttempt: 1,
				lastConnectedAt: null,
				error: null,
			});
			void this.recoverManagedConnection(connectionId, operation);
		}
	}

	private async recoverManagedConnection(
		connectionId: string,
		operation: ConnectionOperation
	): Promise<void> {
		let attempt = 0;
		while (this.isCurrentOperation(connectionId, operation)) {
			attempt++;
			if (attempt > 1) {
				const delay = Math.min(this.recoveryBaseMs * 2 ** (attempt - 2), this.recoveryMaxMs);
				try {
					await abortableDelay(delay, operation.controller.signal);
				} catch {
					return;
				}
			}
			if (!this.isCurrentOperation(connectionId, operation)) return;
			this.connectionStates.set(connectionId, {
				status: "reconnecting",
				reconnectAttempt: attempt,
				lastConnectedAt: null,
				error: null,
			});
			try {
				await this.establishConnection(connectionId, operation);
				this.finishConnectionOperation(connectionId, operation);
				this.drainConnectionFollowUps(connectionId);
				return;
			} catch (error) {
				if (!this.isCurrentOperation(connectionId, operation)) return;
				this.connectionStates.set(connectionId, {
					status: "reconnecting",
					reconnectAttempt: attempt,
					lastConnectedAt: null,
					error: sanitizedConnectionError(error).message,
				});
			}
		}
	}

	private disposeInstalledRuntime(connectionId: string): void {
		const runtime = this.runtimes.get(connectionId);
		if (!runtime) return;
		this.runtimes.delete(connectionId);
		for (const unsubscribe of runtime.unsubscribers.splice(0)) unsubscribe();
		runtime.client.disconnect();
	}

	private bindClient(connectionId: string, runtime: ConnectionRuntime): void {
		runtime.unsubscribers.push(
			runtime.client.subscribe((event) => {
				if (event.type === "runtime.history-refresh-required") {
					this.reconcileAfterReconnect(connectionId, runtime);
					return;
				}
				const mappedIdentity = event.runtimeSessionId
					? (runtime.runtimeToDurable.get(event.runtimeSessionId) ?? null)
					: null;
				const durableSessionId = mappedIdentity
					? this.resolveDurableId(
							runtime,
							mappedIdentity.durableSessionId,
							mappedIdentity.profileId
						)
					: null;
				const mappedEvent = {
					...event,
					profileId: mappedIdentity?.profileId ?? null,
					durableSessionId,
				};
				if (!durableSessionId) {
					this.pushEvent(connectionId, mappedEvent);
					return;
				}
				const binding = this.bindingFor(runtime, durableSessionId, mappedIdentity?.profileId);
				if (event.workspaceArtifacts.length > 0) {
					this.linkArtifacts(connectionId, durableSessionId, event.workspaceArtifacts);
				}
				if (this.isTerminalEvent(event)) {
					if (binding) this.processTerminalEvent(connectionId, runtime, binding, mappedEvent);
					return;
				}
				this.pushEvent(connectionId, mappedEvent);
				if (binding) this.applyInteractionEvent(binding, mappedEvent);
			}),
			runtime.client.subscribeState((state) => {
				const sanitized = sanitizeHermesPayload(state.error);
				this.pushEvent(connectionId, {
					type: "runtime.connection",
					profileId: null,
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

	private processTerminalEvent(
		connectionId: string,
		runtime: ConnectionRuntime,
		binding: RuntimeBinding,
		event: HermesRuntimeEvent
	): boolean {
		if (this.runtimes.get(connectionId) !== runtime || !event.turnId || !event.runtimeSessionId) {
			return false;
		}
		const terminalIdentity = JSON.stringify([event.runtimeSessionId, event.turnId]);
		if (binding.processedTerminalIdentities.includes(terminalIdentity)) return false;
		const active = binding.activeTurnIdentity;
		if (!binding.activeTurn || !active || active.runtimeSessionId !== event.runtimeSessionId) {
			return false;
		}
		if (!active.turnId) {
			if (
				!binding.pendingTerminalEvents.some(
					(candidate) =>
						candidate.runtimeSessionId === event.runtimeSessionId &&
						candidate.turnId === event.turnId
				)
			) {
				binding.pendingTerminalEvents.push(event);
				if (binding.pendingTerminalEvents.length > MAX_PENDING_TERMINAL_EVENTS) {
					binding.pendingTerminalEvents.shift();
				}
			}
			return false;
		}
		if (active.turnId !== event.turnId) return false;

		binding.processedTerminalIdentities.push(terminalIdentity);
		if (binding.processedTerminalIdentities.length > MAX_PROCESSED_TERMINAL_IDENTITIES) {
			binding.processedTerminalIdentities.splice(
				0,
				binding.processedTerminalIdentities.length - MAX_PROCESSED_TERMINAL_IDENTITIES
			);
		}
		binding.activeTurn = false;
		binding.activeTurnIdentity = null;
		binding.activeTurnSnapshot.activeTurn = false;
		binding.activeTurnSnapshot.turnId = null;
		binding.activeTurnSnapshot.status = event.status ?? "complete";
		this.clearPendingInteractions(binding);
		const queue = this.followUpQueues.get(
			hermesSessionCompositeIdentityKey(connectionId, binding.profileId, binding.durableSessionId)
		);
		if (queue?.activeTurnGeneration === active.generation) {
			queue.activeTurnGeneration = null;
			if (queue.active) {
				this.addSettledFollowUp(queue, queue.active);
				queue.active = null;
			}
			this.pushFollowUpQueueEvent(queue);
		}
		this.pushEvent(connectionId, event);
		void this.refreshAfterTerminal(
			connectionId,
			runtime,
			binding.durableSessionId,
			binding.profileId
		);
		if (queue) {
			this.drainFollowUpQueueInBackground(queue);
			this.removeEmptyFollowUpQueue(queue);
		}
		return true;
	}

	private processPendingTerminalEvents(
		connectionId: string,
		runtime: ConnectionRuntime,
		binding: RuntimeBinding
	): void {
		const pending = binding.pendingTerminalEvents.splice(0);
		for (const event of pending) this.processTerminalEvent(connectionId, runtime, binding, event);
	}

	private reconcileAfterReconnect(connectionId: string, runtime: ConnectionRuntime): void {
		if (runtime.reconnectTask || this.runtimes.get(connectionId) !== runtime) return;
		const task = this.reacquireBindings(connectionId, runtime);
		runtime.reconnectTask = task;
		const clear = () => {
			if (runtime.reconnectTask === task) {
				runtime.reconnectTask = null;
				this.drainConnectionFollowUps(connectionId);
			}
		};
		void task.then(clear, clear);
	}

	private async reacquireBindings(connectionId: string, runtime: ConnectionRuntime): Promise<void> {
		const previousBindings = [...runtime.bindings.values()];
		runtime.bindings.clear();
		runtime.runtimeToDurable.clear();
		const bindings: HermesReconnectBindingMetadata[] = [];
		const failedSessionIds: string[] = [];
		for (const previous of previousBindings) {
			const durableSessionId = previous.durableSessionId;
			if (this.runtimes.get(connectionId) !== runtime) return;
			let binding: RuntimeBinding;
			try {
				binding = await this.resumeBinding(
					runtime,
					this.resolveDurableId(runtime, durableSessionId, previous.profileId),
					previous.profileId,
					previous
				);
				if (this.runtimes.get(connectionId) !== runtime) return;
				bindings.push({
					hermesSessionId: durableSessionId,
					durableSessionId: binding.durableSessionId,
					profileId: binding.profileId,
					runtimeSessionId: binding.runtimeSessionId,
					activeTurn: binding.activeTurn,
					status: binding.runtimeStatus,
				});
				this.pushEvent(connectionId, {
					type: "runtime.active-turn-snapshot",
					profileId: binding.profileId,
					runtimeSessionId: binding.runtimeSessionId,
					durableSessionId: binding.durableSessionId,
					turnId: binding.activeTurnSnapshot.turnId,
					requestId: null,
					text: null,
					toolName: null,
					status: binding.runtimeStatus,
					payload: { activeTurnSnapshot: binding.activeTurnSnapshot },
					workspaceArtifacts: [],
					receivedAt: Date.now(),
				});
			} catch (error) {
				if (this.runtimes.get(connectionId) !== runtime) return;
				failedSessionIds.push(durableSessionId);
				this.pushRuntimeError(connectionId, error, durableSessionId, previous.profileId);
				continue;
			}
			try {
				await this.history(connectionId, binding.durableSessionId, binding.profileId);
				if (this.runtimes.get(connectionId) !== runtime) return;
			} catch (error) {
				if (this.runtimes.get(connectionId) !== runtime) return;
				failedSessionIds.push(durableSessionId);
				this.pushRuntimeError(connectionId, error, binding.durableSessionId, binding.profileId);
			}
		}
		if (this.runtimes.get(connectionId) !== runtime) return;
		this.pushEvent(connectionId, {
			type: "runtime.history-refresh-required",
			profileId: null,
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
		profileId: string,
		fallbackActivity?: Pick<RuntimeBinding, "activeTurn" | "runtimeStatus">
	): Promise<RuntimeBinding> {
		const response = await runtime.client.request("session.resume", {
			session_id: durableSessionId,
			profile: profileId,
			source: "superiorswarm",
			omit_messages: false,
		});
		const binding = normalizeHermesSessionBinding(response, durableSessionId, profileId);
		const activity = normalizeHermesRuntimeActivity(response);
		const installed = this.installBinding(runtime, binding, {
			activeTurn: activity.activeTurn ?? fallbackActivity?.activeTurn ?? null,
			status: activity.status ?? fallbackActivity?.runtimeStatus ?? null,
		});
		this.captureActiveTurnSnapshot(runtime, installed, response);
		this.reconcileUncertainFollowUp(runtime, installed, response);
		return installed;
	}

	private async resolveOrigin(
		connectionId: string,
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		requestedProfileId?: string,
		useStoredLink = true
	): Promise<ResolvedHermesOrigin | null> {
		const durableSessionId = this.resolveDurableId(runtime, hermesSessionId, requestedProfileId);
		const profileId = requestedProfileId ?? this.profileFor(runtime, durableSessionId);
		const detail = await runtime.rest.getSessionDetail(durableSessionId, profileId);
		const base = resolveHermesOrigin(detail, {
			connectionMode: runtime.connectionMode,
			senderAvailable: this.sendService.isAvailable(),
		});
		const manualOpenUrl = useStoredLink
			? getHermesOriginLink({
					connectionId,
					profileId,
					hermesSessionId: detail.durableSessionId,
					originFingerprint: base.originFingerprint,
				})
			: null;
		const resolved = manualOpenUrl
			? resolveHermesOrigin(detail, {
					connectionMode: runtime.connectionMode,
					senderAvailable: this.sendService.isAvailable(),
					manualOpenUrl,
				})
			: base;
		runtime.origins.set(hermesSessionIdentityKey(profileId, detail.durableSessionId), resolved);
		return resolved;
	}

	private installBinding(
		runtime: ConnectionRuntime,
		binding: HermesSessionBinding,
		activity?: { activeTurn: boolean | null; status: string | null }
	): RuntimeBinding {
		const bindingKey = hermesSessionIdentityKey(binding.profileId, binding.durableSessionId);
		const previous = runtime.bindings.get(bindingKey);
		if (previous) runtime.runtimeToDurable.delete(previous.runtimeSessionId);
		const activeTurn = activity?.activeTurn ?? previous?.activeTurn ?? false;
		const runtimeStatus = activity?.status ?? previous?.runtimeStatus ?? null;
		const installed: RuntimeBinding = {
			...binding,
			activeTurn,
			runtimeStatus,
			turnGeneration: previous?.turnGeneration ?? 0,
			activeTurnIdentity: null,
			processedTerminalIdentities: [...(previous?.processedTerminalIdentities ?? [])],
			pendingTerminalEvents: [],
			activeTurnSnapshot: {
				durableSessionId: binding.durableSessionId,
				runtimeSessionId: binding.runtimeSessionId,
				eventSeq: runtime.nextSeq,
				activeTurn,
				status: runtimeStatus,
				turnId: null,
				streamingText: "",
				tools: [],
				pendingApproval: activeTurn ? (previous?.activeTurnSnapshot.pendingApproval ?? null) : null,
				pendingClarification: activeTurn
					? (previous?.activeTurnSnapshot.pendingClarification ?? null)
					: null,
				queuedFollowUps: this.queueSummariesForBinding(runtime, binding),
			},
		};
		runtime.bindings.set(bindingKey, installed);
		runtime.runtimeToDurable.set(binding.runtimeSessionId, {
			durableSessionId: binding.durableSessionId,
			profileId: binding.profileId,
		});
		return installed;
	}

	private captureActiveTurnSnapshot(
		runtime: ConnectionRuntime,
		binding: RuntimeBinding,
		response: unknown
	): void {
		const pendingApproval = binding.activeTurnSnapshot.pendingApproval;
		const pendingClarification = binding.activeTurnSnapshot.pendingClarification;
		binding.activeTurnSnapshot = normalizeHermesActiveTurnSnapshot(response, {
			durableSessionId: binding.durableSessionId,
			runtimeSessionId: binding.runtimeSessionId,
			eventSeq: runtime.nextSeq,
			activeTurn: binding.activeTurn,
			status: binding.runtimeStatus,
		});
		binding.activeTurnSnapshot.queuedFollowUps = this.queueSummariesForBinding(runtime, binding);
		if (binding.activeTurn && binding.activeTurnSnapshot.turnId) {
			const current = binding.activeTurnIdentity;
			if (
				current?.runtimeSessionId !== binding.runtimeSessionId ||
				current.turnId !== binding.activeTurnSnapshot.turnId
			) {
				binding.turnGeneration++;
				binding.activeTurnIdentity = {
					generation: binding.turnGeneration,
					runtimeSessionId: binding.runtimeSessionId,
					turnId: binding.activeTurnSnapshot.turnId,
				};
			}
		} else if (!binding.activeTurn) {
			binding.activeTurnIdentity = null;
		}
		if (binding.activeTurn) {
			binding.activeTurnSnapshot.pendingApproval = pendingApproval;
			binding.activeTurnSnapshot.pendingClarification = pendingClarification;
		}
	}

	private reconcileUncertainFollowUp(
		runtime: ConnectionRuntime,
		binding: RuntimeBinding,
		response: unknown
	): void {
		const connectionId = [...this.runtimes].find(([, candidate]) => candidate === runtime)?.[0];
		if (!connectionId) return;
		const queue = this.followUpQueues.get(
			hermesSessionCompositeIdentityKey(connectionId, binding.profileId, binding.durableSessionId)
		);
		if (queue) {
			queue.activeTurnGeneration = binding.activeTurn
				? (binding.activeTurnIdentity?.generation ?? null)
				: null;
		}
		if (queue?.active) {
			const belongsToCurrentTurn = Boolean(
				binding.activeTurn &&
					binding.activeTurnIdentity?.turnId &&
					queue.active.deliveryTurnId === binding.activeTurnIdentity.turnId
			);
			if (belongsToCurrentTurn) {
				queue.activeTurnGeneration = binding.activeTurnIdentity?.generation ?? null;
			} else {
				this.addSettledFollowUp(queue, queue.active);
				queue.active = null;
				queue.activeTurnGeneration = null;
			}
			this.pushFollowUpQueueEvent(queue);
		}
		const followUp = queue?.items[0];
		if (!queue || !followUp || (followUp.status !== "submitting" && !followUp.transportUncertain)) {
			return;
		}
		const evidence = responseDeliveryEvidence(response);
		const message = evidence.userMessages.find((candidate) =>
			this.followUpMatchesEvidence(followUp, candidate)
		);
		const provedByKey = evidence.deliveryKeys.has(followUp.deliveryKey);
		const provedByTurn = Boolean(
			followUp.deliveryTurnId && evidence.turnId === followUp.deliveryTurnId
		);
		if (!message && !provedByKey && !provedByTurn) {
			followUp.status = "failed";
			followUp.transportUncertain = true;
			followUp.error =
				"Hermes reconnect could not confirm or prove this follow-up's delivery. It was not resent.";
			this.pushFollowUpQueueEvent(queue);
			return;
		}
		this.acceptReconciledFollowUp(queue, followUp, binding, message?.turnId ?? evidence.turnId);
		this.pushFollowUpQueueEvent(queue);
	}

	private followUpMatchesEvidence(
		followUp: QueuedFollowUp,
		message: DeliveryEvidenceMessage
	): boolean {
		if (message.deliveryKey === followUp.deliveryKey) return true;
		if (message.id && followUp.knownCanonicalUserMessageIds.includes(message.id)) return false;
		return (
			message.text === followUp.text ||
			(followUp.submittedPromptText !== null && message.text === followUp.submittedPromptText)
		);
	}

	private acceptReconciledFollowUp(
		queue: SessionFollowUpQueue,
		followUp: QueuedFollowUp,
		binding: RuntimeBinding | null,
		turnId: string | null
	): void {
		const index = queue.items.findIndex((candidate) => candidate.id === followUp.id);
		if (index >= 0) queue.items.splice(index, 1);
		followUp.status = "accepted";
		followUp.wasQueued = true;
		followUp.transportUncertain = false;
		followUp.error = null;
		followUp.deliveryTurnId = followUp.deliveryTurnId ?? turnId;
		const activeIdentity = binding?.activeTurnIdentity;
		if (
			binding?.activeTurn &&
			activeIdentity &&
			turnId !== null &&
			activeIdentity.turnId === turnId
		) {
			queue.active = followUp;
			queue.activeTurnGeneration = activeIdentity.generation;
		} else {
			this.addSettledFollowUp(queue, followUp);
			queue.activeTurnGeneration = null;
		}
		this.attachmentStore.releaseClaim(followUp.attachmentHandles, followUp.ownerId);
	}

	private reconcileFollowUpsFromHistory(
		connectionId: string,
		profileId: string,
		history: HermesSessionHistory
	): void {
		const queue = this.followUpQueues.get(
			hermesSessionCompositeIdentityKey(connectionId, profileId, history.durableSessionId)
		);
		if (!queue) return;
		const runtime = this.runtimes.get(connectionId);
		const binding = runtime ? this.bindingFor(runtime, history.durableSessionId, profileId) : null;
		const uncertain = queue.items.find(
			(followUp) => followUp.status === "submitting" || followUp.transportUncertain
		);
		if (uncertain) {
			const message = history.messages
				.filter((candidate) => candidate.role === "user")
				.map(
					(candidate): DeliveryEvidenceMessage => ({
						id: candidate.canonicalMessageId ?? candidate.id,
						turnId: candidate.turnId,
						text: candidate.text,
						deliveryKey: null,
					})
				)
				.find((candidate) => this.followUpMatchesEvidence(uncertain, candidate));
			if (message) this.acceptReconciledFollowUp(queue, uncertain, binding, message.turnId);
		}
		this.queueSummaries(queue);
		this.pushFollowUpQueueEvent(queue);
		this.removeEmptyFollowUpQueue(queue);
	}

	private applyInteractionEvent(binding: RuntimeBinding, event: HermesRuntimeEvent): void {
		if (event.type === "approval.request") {
			binding.activeTurn = true;
			binding.activeTurnSnapshot.activeTurn = true;
			binding.activeTurnSnapshot.pendingApproval = this.pendingInteractionFromEvent(
				event,
				"approval",
				"Hermes needs approval"
			);
			return;
		}
		if (event.type === "clarify.request") {
			binding.activeTurn = true;
			binding.activeTurnSnapshot.activeTurn = true;
			binding.activeTurnSnapshot.pendingClarification = this.pendingInteractionFromEvent(
				event,
				"clarification",
				"Hermes needs more information"
			);
			return;
		}
		if (event.type === "approval.expire" || event.type === "approval.expired") {
			this.clearPendingInteraction(binding, "approval", event.requestId);
			return;
		}
		if (event.type === "clarify.expire" || event.type === "clarify.expired") {
			this.clearPendingInteraction(binding, "clarification", event.requestId);
			return;
		}
		if (this.isTerminalEvent(event)) this.clearPendingInteractions(binding);
	}

	private pendingInteractionFromEvent(
		event: HermesRuntimeEvent,
		fallbackRequestId: string,
		fallbackPrompt: string
	): HermesPendingInteractionSnapshot {
		return {
			requestId: event.requestId ?? fallbackRequestId,
			prompt: event.text ?? fallbackPrompt,
			choices: event.payload.choices?.map((choice) => ({ ...choice })) ?? [],
		};
	}

	private clearPendingInteraction(
		binding: RuntimeBinding,
		kind: "approval" | "clarification",
		requestId: string | null
	): void {
		const key = kind === "approval" ? "pendingApproval" : "pendingClarification";
		const pending = binding.activeTurnSnapshot[key];
		if (!pending || (requestId && pending.requestId !== requestId)) return;
		binding.activeTurnSnapshot[key] = null;
	}

	private clearPendingInteractions(binding: RuntimeBinding): void {
		binding.activeTurnSnapshot.pendingApproval = null;
		binding.activeTurnSnapshot.pendingClarification = null;
	}

	private removeBinding(runtime: ConnectionRuntime, binding: RuntimeBinding): void {
		runtime.bindings.delete(hermesSessionIdentityKey(binding.profileId, binding.durableSessionId));
		runtime.runtimeToDurable.delete(binding.runtimeSessionId);
	}

	private bindingFor(
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		profileId?: string
	): RuntimeBinding | null {
		if (profileId) {
			const durableSessionId = this.resolveDurableId(runtime, hermesSessionId, profileId);
			return runtime.bindings.get(hermesSessionIdentityKey(profileId, durableSessionId)) ?? null;
		}
		const matches = [...runtime.bindings.values()].filter(
			(binding) =>
				binding.durableSessionId === hermesSessionId ||
				this.resolveDurableId(runtime, hermesSessionId, binding.profileId) ===
					binding.durableSessionId
		);
		return matches.length === 1 ? (matches[0] ?? null) : null;
	}

	private requireBinding(
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		profileId?: string
	): RuntimeBinding {
		const binding = this.bindingFor(runtime, hermesSessionId, profileId);
		if (!binding) throw new Error("Resume the Hermes session before using live controls");
		return binding;
	}

	private resolveDurableId(
		runtime: ConnectionRuntime,
		hermesSessionId: string,
		profileId?: string
	): string {
		if (profileId) {
			return (
				runtime.aliases.get(hermesSessionIdentityKey(profileId, hermesSessionId)) ?? hermesSessionId
			);
		}
		const candidates = new Set<string>();
		for (const session of runtime.catalog.sessions) {
			if (session.id !== hermesSessionId) continue;
			candidates.add(
				runtime.aliases.get(hermesSessionIdentityKey(session.profileId, session.id)) ?? session.id
			);
		}
		if (candidates.size > 1) {
			throw new Error("Hermes session profile is ambiguous; select an exact profile");
		}
		return candidates.values().next().value ?? hermesSessionId;
	}

	private profileFor(runtime: ConnectionRuntime, durableSessionId: string): string {
		const profiles = new Set(
			runtime.catalog.sessions
				.filter(
					(session) =>
						session.id === durableSessionId ||
						runtime.aliases.get(hermesSessionIdentityKey(session.profileId, session.id)) ===
							durableSessionId
				)
				.map((session) => session.profileId)
		);
		if (profiles.size > 1) {
			throw new Error("Hermes session profile is ambiguous; select an exact profile");
		}
		return profiles.values().next().value ?? runtime.profileId;
	}

	private async refreshAfterTerminal(
		connectionId: string,
		runtime: ConnectionRuntime,
		durableSessionId: string,
		profileId?: string
	): Promise<void> {
		const binding = this.bindingFor(runtime, durableSessionId, profileId);
		const resolvedProfileId = profileId ?? binding?.profileId ?? null;
		try {
			if (binding) binding.persisted = true;
			await this.history(connectionId, durableSessionId, profileId);
			if (this.runtimes.get(connectionId) !== runtime) return;
			this.pushEvent(connectionId, {
				type: "runtime.history-refresh-required",
				profileId: resolvedProfileId,
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
			if (this.runtimes.get(connectionId) !== runtime) return;
			this.pushRuntimeError(connectionId, error, durableSessionId, resolvedProfileId);
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

	private pushRuntimeError(
		connectionId: string,
		error: unknown,
		durableSessionId: string | null = null,
		profileId: string | null = null
	): void {
		const sanitized = sanitizeHermesPayload(
			error instanceof Error ? error.message : "Hermes runtime error"
		);
		this.pushEvent(connectionId, {
			type: "runtime.error",
			profileId,
			runtimeSessionId: null,
			durableSessionId,
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

	private async refreshCatalog(runtime: ConnectionRuntime): Promise<HermesCatalog> {
		const sessions = await runtime.rest.listSessions();
		runtime.catalog = stockCatalog(
			sessions,
			runtime.connectionMode,
			this.sendService.isAvailable(),
			runtime.managerId
		);
		return runtime.catalog;
	}

	private assertLocallyIdle(binding: RuntimeBinding | null): void {
		if (!binding) {
			throw new Error("Permanent deletion could not prove that the session is idle");
		}
		if (
			binding.activeTurnSnapshot.pendingApproval ||
			binding.activeTurnSnapshot.pendingClarification
		) {
			throw new Error(
				"Resolve the Hermes session's unresolved approval or clarification before deleting it"
			);
		}
		if (binding.activeTurn || binding.activeTurnSnapshot.activeTurn) {
			throw new Error("Stop the Hermes session's active turn before deleting it");
		}
	}

	private async refreshRuntimeIdleProof(
		runtime: ConnectionRuntime,
		profileId: string,
		durableSessionId: string
	): Promise<RuntimeBinding> {
		const response = await runtime.client.request("session.resume", {
			session_id: durableSessionId,
			profile: profileId,
			source: "superiorswarm",
			omit_messages: false,
		});
		const activity = normalizeHermesRuntimeActivity(response);
		if (activity.activeTurn !== false) {
			throw new Error("Permanent deletion could not prove that the session is idle");
		}
		const binding = normalizeHermesSessionBinding(response, durableSessionId, profileId);
		if (binding.profileId !== profileId || binding.durableSessionId !== durableSessionId) {
			throw new Error("Hermes returned a different session identity during the idle check");
		}
		const installed = this.installBinding(runtime, binding, activity);
		this.captureActiveTurnSnapshot(runtime, installed, response);
		return installed;
	}

	private requireCatalogSession(
		runtime: ConnectionRuntime,
		profileId: string,
		durableSessionId: string
	): HermesSessionSummary {
		const matches = runtime.catalog.sessions.filter(
			(session) => session.profileId === profileId && session.id === durableSessionId
		);
		if (matches.length !== 1) {
			throw new Error("Hermes session is not present exactly once in the canonical catalog");
		}
		return matches[0] as HermesSessionSummary;
	}

	private relatedSessionIds(
		runtime: ConnectionRuntime,
		profileId: string,
		durableSessionId: string
	): Set<string> {
		const sessionIds = new Set([durableSessionId]);
		for (const [aliasKey, canonical] of runtime.aliases) {
			const identity = this.identityFromKey(aliasKey);
			if (
				identity?.profileId === profileId &&
				(identity.durableSessionId === durableSessionId || canonical === durableSessionId)
			) {
				sessionIds.add(identity.durableSessionId);
				sessionIds.add(canonical);
			}
		}
		return sessionIds;
	}

	private cleanupDeletedSession(
		connectionId: string,
		runtime: ConnectionRuntime,
		durableSessionId: string,
		profileId: string,
		relatedSessionIds: Set<string>
	): void {
		const runtimeSessionIds = new Set<string>();
		for (const binding of runtime.bindings.values()) {
			if (binding.profileId !== profileId || !relatedSessionIds.has(binding.durableSessionId)) {
				continue;
			}
			runtimeSessionIds.add(binding.runtimeSessionId);
			this.removeBinding(runtime, binding);
		}
		for (const [sessionKey, history] of runtime.histories) {
			const identity = this.identityFromKey(sessionKey);
			if (
				identity?.profileId === profileId &&
				(relatedSessionIds.has(identity.durableSessionId) ||
					relatedSessionIds.has(history.durableSessionId))
			) {
				runtime.histories.delete(sessionKey);
			}
		}
		for (const sessionId of relatedSessionIds) {
			runtime.origins.delete(hermesSessionIdentityKey(profileId, sessionId));
			deleteHermesOriginLink(connectionId, profileId, sessionId);
		}
		const hasProfileCollision = runtime.catalog.sessions.some(
			(session) => session.id === durableSessionId && session.profileId !== profileId
		);
		if (!hasProfileCollision) {
			for (const sessionId of relatedSessionIds) {
				deleteHermesSessionWorkspaceLinks(connectionId, sessionId);
			}
		}
		for (const [aliasKey, canonical] of runtime.aliases) {
			const identity = this.identityFromKey(aliasKey);
			if (
				identity?.profileId === profileId &&
				(relatedSessionIds.has(identity.durableSessionId) || relatedSessionIds.has(canonical))
			) {
				runtime.aliases.delete(aliasKey);
			}
		}
		runtime.events = runtime.events.filter(
			({ event }) =>
				!runtimeSessionIds.has(event.runtimeSessionId ?? "") &&
				(hasProfileCollision || !relatedSessionIds.has(event.durableSessionId ?? ""))
		);
		deleteHermesOriginReports(connectionId, profileId, durableSessionId);
		if (runtime.managerId) {
			deleteHermesSessionAdmission(runtime.managerId, profileId, durableSessionId);
		}
	}

	private identityFromKey(key: string): { profileId: string; durableSessionId: string } | null {
		try {
			const parsed: unknown = JSON.parse(key);
			if (
				Array.isArray(parsed) &&
				parsed.length === 2 &&
				typeof parsed[0] === "string" &&
				typeof parsed[1] === "string"
			) {
				return { profileId: parsed[0], durableSessionId: parsed[1] };
			}
		} catch {
			// Legacy in-memory maps are discarded unless their composite identity is explicit.
		}
		return null;
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
