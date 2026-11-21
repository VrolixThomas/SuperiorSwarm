/** All activity queue timestamps are Unix milliseconds, including across tRPC. */
export const ACTIVITY_QUEUE_KINDS = [
	"agent-input",
	"agent-ready",
	"pr-review",
	"pr-update",
] as const;
export type ActivityQueueKind = (typeof ACTIVITY_QUEUE_KINDS)[number];

export type ActivityQueueTarget =
	| { type: "workspace"; workspaceId: string }
	| {
			type: "terminal";
			workspaceId: string;
			terminalId: string;
			provider: string;
			providerSessionId: string | null;
	  }
	| {
			type: "pr";
			provider: "github" | "bitbucket";
			owner: string;
			repo: string;
			number: number;
			title?: string;
			sourceBranch?: string;
			targetBranch?: string;
			projectId?: string;
			workspaceId?: string;
	  }
	| { type: "hermes"; profileId: string; sessionId: string; workspaceId?: string }
	| { type: "unavailable"; reason: string };

export interface ActivityQueueReason {
	code: string;
	label: string;
}
export interface ActivityQueueCandidate {
	kind: ActivityQueueKind;
	title: string;
	summary: string;
	projectId?: string;
	projectName?: string;
	occurredAt: number;
	reasons: ActivityQueueReason[];
	target: ActivityQueueTarget;
}
export interface ActivityQueueItem extends ActivityQueueCandidate {
	id: string;
	revision: number;
	acknowledged: boolean;
	stale: boolean;
}
export interface ActivityQueueListInput {
	projectId?: string;
	kinds?: ActivityQueueKind[];
	includeAcknowledged?: boolean;
}
export interface ActivityQueueListResult {
	items: ActivityQueueItem[];
	/** False when current agent inventory could not be confirmed. */
	agentStatusAvailable?: boolean;
	/** Global pending count, independent of filters. */
	totalPending: number;
	updatedAt: number | null;
	sourceErrors: { sourceId: string; error: string; observedAt: number }[];
}
export type ActivityQueueAcknowledgeResult =
	| { status: "acknowledged"; item: ActivityQueueItem }
	| { status: "conflict"; item: ActivityQueueItem | null }
	| { status: "not-found" };

/** Source adapters must validate recovered snapshot payloads before using them. */
export interface ActivityQueueObservation {
	sourceId: string;
	sourceType: string;
	snapshot: unknown;
	/** Semantic identity only: exclude poll time and display-only enrichment. */
	fingerprint: string;
	candidate: ActivityQueueCandidate | null;
	observedAt: number;
}
export interface ActivityQueueSource extends ActivityQueueObservation {
	revision: number;
	acknowledgedRevision: number | null;
	error: string | null;
}

/** Read-time workspace projection; display enrichment never changes source identity. */
export interface WorkspaceQueueItem extends ActivityQueueItem {
	category: "agents";
	situation: "agent-input" | "agent-permission" | "agent-question" | "agent-failed" | "agent-done";
	subject: string;
	why: string;
	clearsWhen: string;
	context: {
		projectId?: string;
		projectName: string;
		projectColor?: string | null;
		/** Stable project fallback color index, 1..8. */
		projectTint: number;
		workspaceId: string;
		workspaceName: string;
		provider?: string;
	};
	evidence: string[];
	snoozed?: { until: number | null; untilChange: boolean };
}

export interface WorkspaceQueueListInput {
	view?: "pending" | "later";
	projectId?: string;
}

export interface WorkspaceQueueListResult {
	items: WorkspaceQueueItem[];
	/** Global workspace counts, independent of view and project filters. */
	totalPending: number;
	laterCount: number;
	updatedAt: number | null;
	sourceErrors: ActivityQueueListResult["sourceErrors"];
	agentStatusAvailable?: boolean;
}

export interface WorkspaceQueueRevisionInput {
	id: string;
	revision: number;
}
export interface WorkspaceQueueLaterInput extends WorkspaceQueueRevisionInput {
	until?: number;
	untilChange: boolean;
}
export type WorkspaceQueueLaterResult = { status: "snoozed" | "conflict" | "not-found" };
export type WorkspaceQueueRestoreResult = { status: "restored" | "conflict" | "not-found" };
