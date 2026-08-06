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
	| "upgrade-required"
	| "error";

export interface HermesRuntimeState {
	status: HermesConnectionStatus;
	reconnectAttempt: number;
	lastConnectedAt: number | null;
	error: string | null;
}

export interface HermesCompatibility {
	state: "compatible" | "upgrade-required";
	protocolVersion: number | null;
	capabilities: string[];
	missingCapabilities: string[];
}

export interface HermesSessionSummary {
	id: string;
	lineageTipId: string;
	lineageRootId: string | null;
	title: string;
	preview: string;
	profileId: string;
	source: string;
	updatedAt: number;
	createdAt: number;
	open: boolean;
	archived: boolean;
	running: boolean;
	busy: boolean;
	claimed: boolean;
	waitingForUser: boolean;
	originLabel: string | null;
	canOpenOrigin: boolean;
	canReportToOrigin: boolean;
	opaqueOriginRef: string | null;
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

export interface HermesTurnResult {
	turnId: string;
	content: string;
	completedAt: number | null;
	status: string | null;
}

export interface HermesSessionHistory {
	messages: HermesTranscriptMessage[];
	turnResults: HermesTurnResult[];
}

export interface HermesInteractionChoiceDto {
	value: string;
	label: string;
}

export interface HermesReconnectBindingMetadata {
	hermesSessionId: string;
	canonicalSessionId: string;
	runtimeSessionId: string;
	claimId: string;
	bindingGeneration: number;
}

export interface HermesRuntimeEventPayload {
	choices?: HermesInteractionChoiceDto[];
	bindings?: HermesReconnectBindingMetadata[];
	failedSessionIds?: string[];
}

export interface HermesRuntimeEvent {
	type: string;
	sessionId: string | null;
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

export interface HermesBindingReleaseResult {
	unbound: boolean;
	released: boolean;
	retryable: boolean;
	error: string | null;
}

export interface HermesConnectionSummary {
	id: string;
	label: string;
	baseUrl: string;
	profileId: string;
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

export interface HermesOriginInfo {
	displayLabel: string | null;
	canOpen: boolean;
	canReport: boolean;
	permalink: string | null;
}

export interface HermesOriginReportState {
	connectionId: string;
	hermesSessionId: string;
	turnId: string;
	status: "pending" | "sent" | "failed" | "duplicate-suppressed";
	retryable: boolean;
	messageId: string | null;
	permalink: string | null;
	errorCode: string | null;
	updatedAt: number;
}
