import {
	type HermesActiveTurnSnapshot,
	type HermesCatalog,
	type HermesOriginProjection,
	type HermesOriginReportState,
	type HermesPendingInteractionSnapshot,
	type HermesReconnectBindingMetadata,
	type HermesRuntimeEvent,
	type HermesRuntimeState,
	type HermesSessionBinding,
	type HermesSessionHistory,
	type HermesSessionSummary,
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
	private readonly externalManagerIdResolver: NonNullable<
		HermesRuntimeServiceOptions["externalManagerIdResolver"]
	>;
	private readonly connectionGenerations = new Map<string, number>();
	private readonly connectionOperations = new Map<string, ConnectionOperation>();
	private readonly connectionStates = new Map<string, HermesRuntimeState>();
	private readonly submitReservations = new Map<string, Set<string>>();
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
		this.connectionStates.delete(connectionId);
		this.submitReservations.delete(connectionId);
	}

	getState(connectionId: string): HermesRuntimeState {
		return (
			this.runtimes.get(connectionId)?.client.getState() ??
			this.connectionStates.get(connectionId) ?? {
				status: "disconnected",
				reconnectAttempt: 0,
				lastConnectedAt: null,
				error: null,
			}
		);
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
				this.pushRuntimeError(connectionId, error, durableSessionId);
			}
			let catalog: HermesCatalog | null = null;
			try {
				catalog = await this.refreshCatalog(runtime);
			} catch (error) {
				reconciliationRequired = true;
				this.pushRuntimeError(connectionId, error, durableSessionId);
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
			this.pushRuntimeError(connectionId, error, binding.durableSessionId);
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
				const installed = this.installBinding(
					runtime,
					activated,
					normalizeHermesRuntimeActivity(response)
				);
				this.captureActiveTurnSnapshot(runtime, installed, response);
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
		const runtime = this.requireRuntime(connectionId);
		const profileId = requestedProfileId ?? this.profileFor(runtime, hermesSessionId);
		const reservedSessionIds = this.reserveSubmit(
			runtime,
			connectionId,
			hermesSessionId,
			profileId
		);
		let binding = this.bindingFor(runtime, hermesSessionId, profileId);
		let ownsActiveTurn = false;
		try {
			if (!binding) {
				await this.resume(connectionId, hermesSessionId, profileId);
				binding = this.requireBinding(runtime, hermesSessionId, profileId);
				this.extendSubmitReservation(
					connectionId,
					binding.durableSessionId,
					reservedSessionIds,
					binding.profileId
				);
			}
			if (binding.activeTurn) {
				throw new Error("A Hermes turn is already active for this session");
			}
			binding.activeTurn = true;
			this.clearPendingInteractions(binding);
			ownsActiveTurn = true;
			const attachments = await this.attachmentStore.resolve(attachmentHandles);
			const attached = [];
			for (const attachment of attachments) {
				const result = await this.attachFile(runtime, binding, attachment);
				attached.push({
					kind: attachment.kind,
					name: attachment.name,
					refText: result.refText,
				});
			}
			await runtime.client.request(
				"prompt.submit",
				{
					session_id: binding.runtimeSessionId,
					text: buildHermesAttachmentPromptText(text, attached),
				},
				{ timeoutMs: PROMPT_SUBMIT_TIMEOUT_MS }
			);
			this.attachmentStore.release(attachmentHandles);
			return { ok: true };
		} catch (error) {
			if (binding && ownsActiveTurn) binding.activeTurn = false;
			throw error;
		} finally {
			this.releaseSubmitReservation(connectionId, reservedSessionIds);
		}
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
		this.attachmentStore.clear();
		this.localBackendManager.shutdown();
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

	private extendSubmitReservation(
		connectionId: string,
		durableSessionId: string,
		reservedSessionIds: Set<string>,
		profileId: string
	): void {
		const reservationKey = hermesSessionIdentityKey(profileId, durableSessionId);
		if (reservedSessionIds.has(reservationKey)) return;
		const reservations = this.submitReservations.get(connectionId);
		if (reservations?.has(reservationKey)) {
			throw new Error("A Hermes turn is already active for this session");
		}
		reservations?.add(reservationKey);
		reservedSessionIds.add(reservationKey);
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
				const mappedEvent = { ...event, durableSessionId };
				this.pushEvent(connectionId, mappedEvent);
				if (!durableSessionId) return;
				const binding = this.bindingFor(runtime, durableSessionId, mappedIdentity?.profileId);
				if (binding) this.applyInteractionEvent(binding, mappedEvent);
				if (event.workspaceArtifacts.length > 0) {
					this.linkArtifacts(connectionId, durableSessionId, event.workspaceArtifacts);
				}
				if (this.isTerminalEvent(event)) {
					if (binding) binding.activeTurn = false;
					void this.refreshAfterTerminal(
						connectionId,
						runtime,
						durableSessionId,
						mappedIdentity?.profileId
					);
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
					runtimeSessionId: binding.runtimeSessionId,
					activeTurn: binding.activeTurn,
					status: binding.runtimeStatus,
				});
				this.pushEvent(connectionId, {
					type: "runtime.active-turn-snapshot",
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
				this.pushRuntimeError(connectionId, error);
				continue;
			}
			try {
				await this.history(connectionId, binding.durableSessionId, binding.profileId);
				if (this.runtimes.get(connectionId) !== runtime) return;
			} catch (error) {
				if (this.runtimes.get(connectionId) !== runtime) return;
				failedSessionIds.push(durableSessionId);
				this.pushRuntimeError(connectionId, error);
			}
		}
		if (this.runtimes.get(connectionId) !== runtime) return;
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
		if (binding.activeTurn) {
			binding.activeTurnSnapshot.pendingApproval = pendingApproval;
			binding.activeTurnSnapshot.pendingClarification = pendingClarification;
		}
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
		try {
			const binding = this.bindingFor(runtime, durableSessionId, profileId);
			if (binding) binding.persisted = true;
			await this.history(connectionId, durableSessionId, profileId);
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
			if (this.runtimes.get(connectionId) !== runtime) return;
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

	private pushRuntimeError(
		connectionId: string,
		error: unknown,
		durableSessionId: string | null = null
	): void {
		const sanitized = sanitizeHermesPayload(
			error instanceof Error ? error.message : "Hermes runtime error"
		);
		this.pushEvent(connectionId, {
			type: "runtime.error",
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
