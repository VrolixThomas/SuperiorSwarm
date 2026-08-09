export const HERMES_WORKSPACE_ARTIFACT_KIND = "superiorswarm.workspace.created" as const;

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
	displayLabel: string | null;
	hasThread: boolean;
	canOpenThread: boolean;
	canReport: boolean;
	openUrl: string | null;
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
	origin: HermesOriginProjection | null;
}

export interface HermesCatalog {
	compatibility: HermesCompatibility;
	sessions: HermesSessionSummary[];
}

export interface HermesTranscriptMessage {
	id: string;
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
	messages: HermesTranscriptMessage[];
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
	runtimeSessionId: string;
}

export interface HermesRuntimeEventPayload {
	choices?: HermesInteractionChoiceDto[];
	bindings?: HermesReconnectBindingMetadata[];
	failedSessionIds?: string[];
}

/** Runtime events are routed only by the ephemeral WebSocket session ID. */
export interface HermesRuntimeEvent {
	type: string;
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
	sessionId: string;
}

export interface HermesConnectionSummary {
	id: string;
	label: string;
	baseUrl: string;
	profileId: string;
	authMode: "token";
	connectionMode: "loopback" | "remote";
	hasToken: boolean;
	tokenStorage: "safe-storage" | "memory";
	lastConnectedAt: number | null;
	createdAt: number;
	updatedAt: number;
}

export interface HermesLinkedWorkspace {
	id: string;
	connectionId: string;
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
