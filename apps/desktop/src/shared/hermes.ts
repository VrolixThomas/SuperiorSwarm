export const HERMES_WORKSPACE_ARTIFACT_KIND = "superiorswarm.workspace.created" as const;

export function isHermesLoopbackUrl(value: string): boolean {
	let hostname: string;
	try {
		hostname = new URL(value).hostname.toLowerCase();
	} catch {
		return false;
	}
	return (
		hostname === "localhost" ||
		hostname === "::1" ||
		hostname === "[::1]" ||
		/^127(?:\.\d{1,3}){3}$/.test(hostname)
	);
}

export interface HermesWorkspaceArtifact {
	kind: typeof HERMES_WORKSPACE_ARTIFACT_KIND;
	workspaceId: string;
	projectId: string;
	branch: string;
	worktreePath: string;
}

export type HermesConnectionStatus =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "error";

export interface HermesRuntimeState {
	status: HermesConnectionStatus;
	reconnectAttempt: number;
	lastConnectedAt: number | null;
	error: string | null;
	queuedFollowUps?: HermesQueuedFollowUpRuntimeSummary[];
}

/** Local integration capabilities. Stock Hermes does not expose a handoff protocol gate. */
export interface HermesCompatibility {
	state: "compatible";
	authMode: "token" | "oauth";
	canBrowse: boolean;
	canChat: boolean;
	canReport: boolean;
	limitations: string[];
}

export interface HermesOriginProjection {
	platform: "slack" | string;
	source: string;
	displayLabel: string | null;
	workspaceLabel: string | null;
	accountLabel: string | null;
	chatLabel: string | null;
	channelLabel: string | null;
	threadLabel: string | null;
	hasThread: boolean;
	canOpenThread: boolean;
	canReport: boolean;
}

/** Renderer-safe persisted session summary. `id` is always the durable Hermes ID. */
export interface HermesSessionSummary {
	id: string;
	title: string;
	preview: string;
	profileId: string;
	source: string;
	updatedAt: number;
	createdAt: number;
	archived: boolean;
	running: boolean;
	busy: boolean;
	waitingForUser: boolean;
	messageCount: number;
	isCron: boolean;
	handover: boolean;
	admissionReason: "agents" | "mcp" | "handover" | null;
	origin: HermesOriginProjection | null;
}

export interface HermesCatalog {
	compatibility: HermesCompatibility;
	sessions: HermesSessionSummary[];
}

export interface HermesTranscriptMessage {
	id: string;
	canonicalMessageId: string | null;
	compactionGeneration: number | null;
	active: boolean | null;
	compacted: boolean | null;
	displayKind: string | null;
	compactionSummaryType: "standalone" | "merged" | "micro" | "legacy" | null;
	turnId: string | null;
	role: "user" | "assistant" | "system" | "tool";
	text: string;
	createdAt: number | null;
	status: string | null;
	toolName: string | null;
	workspaceArtifacts: HermesWorkspaceArtifact[];
}

export interface HermesSessionHistory {
	durableSessionId: string;
	view: "active" | "durable";
	messages: HermesTranscriptMessage[];
}

export type HermesAttachmentKind = "image" | "pdf" | "file";

export const HERMES_MAX_ATTACHMENTS = 10;
export const HERMES_IMAGE_ATTACHMENT_MAX_BYTES = 16 * 1024 * 1024;
export const HERMES_PDF_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const HERMES_GENERAL_ATTACHMENT_MAX_BYTES = 32 * 1024 * 1024;
export const HERMES_ATTACHMENT_IPC_MAX_BYTES = 64 * 1024 * 1024;
export const HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES = 256 * 1024;

export interface HermesRendererAttachmentUpload {
	name: string;
	size: number;
	mimeType: string;
	bytes: Uint8Array;
}

export type HermesRendererAttachmentUploadMetadata = Omit<HermesRendererAttachmentUpload, "bytes">;

export interface HermesRendererAttachmentUploadStart {
	uploadId: string;
	files: Array<{ fileId: string }>;
}

export const HERMES_ATTACHMENT_CONTEXT_START = "[SuperiorSwarm attachments]";
export const HERMES_ATTACHMENT_CONTEXT_END = "[/SuperiorSwarm attachments]";

export function isSafeHermesFileReference(value: unknown): value is string {
	if (typeof value !== "string" || !value.startsWith("@file:") || value.length > 4_096) {
		return false;
	}
	const relativePath = value.slice("@file:".length);
	const hasControlCharacter = Array.from(relativePath).some((character) => {
		const code = character.charCodeAt(0);
		return code <= 31 || (code >= 127 && code <= 159);
	});
	if (
		!relativePath ||
		relativePath.startsWith("/") ||
		relativePath.startsWith("\\") ||
		relativePath.startsWith("~") ||
		relativePath.includes("\\") ||
		hasControlCharacter ||
		/[:?#%]/u.test(relativePath)
	) {
		return false;
	}
	const segments = relativePath.split("/");
	return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** Renderer-safe metadata for a main-owned, temporary attachment handle. */
export interface HermesAttachmentMetadata {
	handle: string;
	name: string;
	size: number;
	mimeType: string;
	kind: HermesAttachmentKind;
	expiresAt: number;
}

export interface HermesSessionBinding {
	runtimeSessionId: string;
	durableSessionId: string;
	profileId: string;
	persisted: boolean;
}

export interface HermesInteractionChoiceDto {
	value: string;
	label: string;
}

export interface HermesReconnectBindingMetadata {
	hermesSessionId: string;
	durableSessionId: string;
	profileId: string;
	runtimeSessionId: string;
	activeTurn: boolean;
	status: string | null;
}

export interface HermesPendingInteractionSnapshot {
	requestId: string;
	prompt: string;
	choices: HermesInteractionChoiceDto[];
}

export interface HermesActiveTurnSnapshot {
	durableSessionId: string;
	runtimeSessionId: string;
	eventSeq: number;
	activeTurn: boolean;
	status: string | null;
	turnId: string | null;
	streamingText: string;
	tools: Array<{
		id: string;
		turnId: string | null;
		name: string;
		status: "running" | "complete" | "failed";
	}>;
	pendingApproval: HermesPendingInteractionSnapshot | null;
	pendingClarification: HermesPendingInteractionSnapshot | null;
	queuedFollowUps: HermesQueuedFollowUpSummary[];
}

export type HermesQueuedFollowUpStatus = "queued" | "submitting" | "accepted" | "failed";

/** Renderer-safe queue projection. Attachment handles, bytes, paths, and credentials stay in main. */
export interface HermesQueuedFollowUpSummary {
	id: string;
	durableSessionId: string;
	profileId: string;
	text: string;
	attachments: Array<Pick<HermesAttachmentMetadata, "kind" | "name">>;
	knownCanonicalUserMessageIds: string[];
	status: HermesQueuedFollowUpStatus;
	error: string | null;
	createdAt: number;
}

/** Connection-level queue state intentionally omits message and attachment content. */
export interface HermesQueuedFollowUpRuntimeSummary {
	durableSessionId: string;
	profileId: string;
	queuedCount: number;
	failedCount: number;
}

export interface HermesRuntimeEventPayload {
	choices?: HermesInteractionChoiceDto[];
	bindings?: HermesReconnectBindingMetadata[];
	failedSessionIds?: string[];
	activeTurnSnapshot?: HermesActiveTurnSnapshot;
	queuedFollowUps?: HermesQueuedFollowUpSummary[];
}

/** Runtime events are routed only by the ephemeral WebSocket session ID. */
export interface HermesRuntimeEvent {
	type: string;
	profileId: string | null;
	runtimeSessionId: string | null;
	durableSessionId: string | null;
	turnId: string | null;
	requestId: string | null;
	text: string | null;
	toolName: string | null;
	status: string | null;
	payload: HermesRuntimeEventPayload;
	workspaceArtifacts: HermesWorkspaceArtifact[];
	receivedAt: number;
}

export interface HermesSessionSelection {
	connectionId: string;
	/** Present on canonical selections; omitted only while restoring legacy persisted state. */
	profileId?: string;
	sessionId: string;
}

/**
 * Complete local scope for renderer-authored text that has not been accepted by Hermes yet.
 * Nullable manager/project values are explicit global scopes, not omitted identity dimensions.
 */
export interface HermesComposerDraftIdentity {
	managerId: string | null;
	projectId: string | null;
	connectionId: string;
	profileId: string;
	durableSessionId: string;
}

export function hermesSessionIdentityKey(profileId: string, durableSessionId: string): string {
	return JSON.stringify([profileId, durableSessionId]);
}

export function hermesSessionCompositeIdentityKey(
	connectionId: string,
	profileId: string,
	durableSessionId: string
): string {
	return JSON.stringify([connectionId, profileId, durableSessionId]);
}

export type HermesSessionPane = "chat" | "worktrees";

export interface HermesConnectionSummary {
	id: string;
	label: string;
	baseUrl: string | null;
	profileId: string;
	managerId: string | null;
	managerBindingMode: "auto" | "manual" | null;
	authMode: "token";
	connectionMode: "loopback" | "remote";
	managementMode: "managed" | "external";
	hasToken: boolean;
	tokenStorage: "safe-storage" | "memory";
	lastConnectedAt: number | null;
	createdAt: number;
	updatedAt: number;
}

export interface HermesLinkedWorkspace {
	id: string;
	connectionId: string;
	profileId: string;
	hermesSessionId: string;
	hermesLineageRootId: string | null;
	workspaceId: string;
	source: "tool-artifact" | "manual";
	linkedAt: number;
	missing: boolean;
	projectId: string | null;
	projectName: string | null;
	workspaceName: string | null;
	branch: string | null;
	worktreePath: string | null;
	currentPhase: "idle" | "working" | "blocked" | "done" | null;
	statusText: string | null;
	needs: string | null;
	statusUpdatedAt: number | null;
	hasTerminal: boolean;
}

export interface HermesOriginReportState {
	connectionId: string;
	hermesSessionId: string;
	messageId: string;
	status: "pending" | "sending" | "sent" | "failed" | "duplicate-suppressed";
	retryable: boolean;
	providerMessageId: string | null;
	errorCode: string | null;
	attemptCount: number;
	updatedAt: number;
}
