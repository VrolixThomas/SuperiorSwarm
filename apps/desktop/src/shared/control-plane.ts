import { z } from "zod";
import type { HermesWorkspaceArtifact } from "./hermes";

// ---- Request schemas ----

export const createWorkspaceRequestSchema = z.object({
	projectId: z.string().min(1),
	branch: z.string().min(1),
	baseBranch: z.string().min(1).optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const listWorkspacesRequestSchema = z.object({
	projectId: z.string().min(1),
});
export type ListWorkspacesRequest = z.infer<typeof listWorkspacesRequestSchema>;

export const getWorkspaceRequestSchema = z.object({
	projectId: z.string().optional(),
	workspaceId: z.string().min(1),
});
export type GetWorkspaceRequest = z.infer<typeof getWorkspaceRequestSchema>;

export const dispatchAgentRequestSchema = z.object({
	projectId: z.string().optional(),
	workspaceId: z.string().min(1),
	prompt: z.string().min(1),
	cliPreset: z.enum(["claude", "codex", "gemini", "opencode"]).optional(),
	skipPermissions: z.boolean().optional(),
});
export type DispatchAgentRequest = z.infer<typeof dispatchAgentRequestSchema>;

export const removeWorkspaceRequestSchema = z.object({
	projectId: z.string().optional(),
	workspaceId: z.string().min(1),
	force: z.boolean().optional(),
});
export type RemoveWorkspaceRequest = z.infer<typeof removeWorkspaceRequestSchema>;

// ---- Status ----

export const phaseSchema = z.enum(["idle", "working", "blocked", "done"]);
export type WorkspacePhase = z.infer<typeof phaseSchema>;

export const setStatusRequestSchema = z.object({
	phase: phaseSchema,
	statusText: z.string().max(2000).optional(),
	needs: z.string().max(2000).optional(),
});
export type SetStatusRequest = z.infer<typeof setStatusRequestSchema>;

export interface SetStatusResponse {
	ok: true;
}

// ---- Response DTOs ----

export interface WorkspaceDto {
	id: string;
	projectId: string;
	type: "branch" | "worktree" | "review" | "folder";
	name: string;
	branch: string | null;
	worktreePath: string | null;
	/** Resolved working directory: worktree path, else folderPath, else project path. */
	path: string;
	baseBranch: string | null;
	prProvider: string | null;
	prIdentifier: string | null;
	draftStatus: string | null;
	currentPhase: WorkspacePhase;
	statusText: string | null;
	needs: string | null;
	statusUpdatedAt: string | null;
	isOrchestrator: boolean;
	cliPreset: string | null;
}

export interface CreateWorkspaceResponse {
	workspaceId: string;
	projectId: string;
	worktreeId: string;
	path: string;
	branch: string;
	baseBranch: string;
	/** True when the branch already existed (locally or on origin) and was checked out instead of created. */
	reusedExistingBranch: boolean;
	createdAt: Date;
	updatedAt: Date;
	/** Stable cross-runtime correlation record; legacy response fields remain unchanged. */
	artifact: HermesWorkspaceArtifact;
}

export interface ListWorkspacesResponse {
	workspaces: WorkspaceDto[];
}

export interface GetWorkspaceResponse extends WorkspaceDto {
	hasUncommittedChanges: boolean;
}

export interface DispatchAgentResponse {
	sessionId: string;
	terminalId: string;
	status: "started";
}

export type RemoveWorkspaceStatus = "removed" | "cancelled_by_user" | "blocked_uncommitted";

export interface RemoveWorkspaceResponse {
	status: RemoveWorkspaceStatus;
}

// ---- Error envelope ----

export interface ControlPlaneError {
	error:
		| "validation"
		| "unauthorized"
		| "forbidden"
		| "not_found"
		| "git_conflict"
		| "cancelled_by_user"
		| "resume_not_supported"
		| "internal";
	message?: string;
	details?: unknown;
}

// ---- Sentinel error class ----

export class CancelledByUserError extends Error {
	constructor() {
		super("cancelled_by_user");
		this.name = "CancelledByUserError";
	}
}

export class NotFoundError extends Error {
	constructor(detail?: string) {
		super(detail ? `not_found: ${detail}` : "not_found");
		this.name = "NotFoundError";
	}
}

export class ForbiddenError extends Error {
	constructor(detail?: string) {
		super(detail ? `forbidden: ${detail}` : "forbidden");
		this.name = "ForbiddenError";
	}
}

export class ResumeNotSupportedError extends Error {
	constructor(detail?: string) {
		super(detail ? `resume_not_supported: ${detail}` : "resume_not_supported");
		this.name = "ResumeNotSupportedError";
	}
}

// ---- Messages ----

export const messageKindSchema = z.enum(["note", "question", "answer"]);
export type MessageKindInput = z.infer<typeof messageKindSchema>;

export const allMessageKinds = ["resume", "note", "question", "answer", "broadcast"] as const;
export type AgentMessageKind = (typeof allMessageKinds)[number];

export const sendMessageRequestSchema = z.object({
	// omit to broadcast to all workspaces in the project
	toWorkspaceId: z.string().min(1).optional(),
	kind: messageKindSchema,
	content: z.string().min(1).max(8192),
	inReplyTo: z.string().min(1).optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export interface SendMessageResponse {
	messageId: string;
}

export const readMessagesRequestSchema = z.object({
	since: z.string().datetime().optional(),
	includeBroadcasts: z.boolean().optional(),
});
export type ReadMessagesRequest = z.infer<typeof readMessagesRequestSchema>;

export interface AgentMessageDto {
	id: string;
	fromWorkspaceId: string | null;
	toWorkspaceId: string | null;
	/** Full kind set from DB. API callers can only send via messageKindSchema (3 kinds: note/question/answer). */
	kind: AgentMessageKind;
	content: string;
	inReplyTo: string | null;
	createdAt: string;
}

export interface ReadMessagesResponse {
	messages: AgentMessageDto[];
}

// ---- Events polling (external managers + non-Claude orchestrators) ----

export const eventsPollRequestSchema = z.object({
	afterSeq: z.coerce.number().int().min(0).default(0),
	waitMs: z.coerce.number().int().min(0).max(55_000).default(25_000),
});
export type EventsPollRequest = z.infer<typeof eventsPollRequestSchema>;

export interface EventsPollResponse {
	/** Parsed jsonl event objects after the cursor. Unparseable lines are skipped. */
	events: unknown[];
	/** New cursor: total line count of the events file. */
	nextSeq: number;
}

// ---- Projects (external manager discovery) ----

export interface ProjectDto {
	id: string;
	name: string;
	repoPath: string;
	defaultBranch: string;
	kind: "repo" | "folder";
}

export interface ListProjectsResponse {
	projects: ProjectDto[];
}

// ---- Agent output snapshot ----

export const agentOutputRequestSchema = z.object({
	workspaceId: z.string().min(1),
	lines: z.coerce.number().int().min(1).max(500).default(100),
});
export type AgentOutputRequest = z.infer<typeof agentOutputRequestSchema>;

export interface AgentOutputResponse {
	workspaceId: string;
	/** ANSI-stripped tail of the workspace's most recent terminal scrollback; null if none. */
	output: string | null;
	/** When the scrollback row was last persisted; output may lag live terminal slightly. */
	capturedAt: string | null;
}

// ---- Hermes session admission (authenticated external managers only) ----

const hermesDurableSessionIdSchema = z
	.string()
	.min(1)
	.max(512)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/);
const hermesProfileIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^(?:default|custom|[a-z0-9][a-z0-9_-]{0,63})$/);
const hermesSourcePlatformSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

export const hermesSessionMetadataSchema = z
	.object({
		schemaVersion: z.literal(1),
		durableSessionId: hermesDurableSessionIdSchema,
		profileId: hermesProfileIdSchema,
		sourcePlatform: hermesSourcePlatformSchema,
		isCron: z.boolean(),
	})
	.strict();
export type HermesSessionMetadata = z.infer<typeof hermesSessionMetadataSchema>;

export const hermesSessionAdmissionRequestSchema = z
	.object({
		metadata: hermesSessionMetadataSchema,
		reason: z.enum(["mcp", "handover"]),
	})
	.strict();
export type HermesSessionAdmissionRequest = z.infer<typeof hermesSessionAdmissionRequestSchema>;

// ---- Hermes session tags (authenticated current-session MCP only) ----

const hermesSessionTagIdentityShape = {
	connectionId: z.string().min(1).max(200),
	metadata: hermesSessionMetadataSchema,
};
const hermesSessionTagSchema = z
	.string()
	.max(100)
	.refine((value) => value.trim().length > 0, "Tag cannot be empty");

export const hermesSessionTagsReadRequestSchema = z.object(hermesSessionTagIdentityShape).strict();
export const hermesSessionTagsSetRequestSchema = z
	.object({
		...hermesSessionTagIdentityShape,
		tags: z.array(hermesSessionTagSchema).max(64),
		expectedRevision: z.number().int().min(0),
	})
	.strict();
export const hermesSessionTagMutationRequestSchema = z
	.object({ ...hermesSessionTagIdentityShape, tag: hermesSessionTagSchema })
	.strict();

export const hermesTagColorSchema = z.enum([
	"gray",
	"blue",
	"cyan",
	"green",
	"amber",
	"orange",
	"red",
	"pink",
	"purple",
]);
const hermesTagDefinitionIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z0-9_-]+$/);

export const hermesTagDefinitionsListRequestSchema = z
	.object({
		...hermesSessionTagIdentityShape,
		query: z.string().max(100).default(""),
	})
	.strict();
export const hermesTagDefinitionUpsertRequestSchema = z
	.object({
		...hermesSessionTagIdentityShape,
		name: hermesSessionTagSchema,
		color: hermesTagColorSchema,
	})
	.strict();
export const hermesTagDefinitionUpdateRequestSchema = z
	.object({
		...hermesSessionTagIdentityShape,
		definitionId: hermesTagDefinitionIdSchema,
		name: hermesSessionTagSchema.optional(),
		color: hermesTagColorSchema.optional(),
		expectedRevision: z.number().int().min(0),
	})
	.strict()
	.refine((value) => value.name !== undefined || value.color !== undefined, {
		message: "A name or color update is required",
	});
export const hermesTagDefinitionDeleteRequestSchema = z
	.object({
		...hermesSessionTagIdentityShape,
		definitionId: hermesTagDefinitionIdSchema,
		expectedRevision: z.number().int().min(0),
	})
	.strict();
export const hermesSessionTagAssignmentMutationRequestSchema = z
	.object({
		...hermesSessionTagIdentityShape,
		definitionId: hermesTagDefinitionIdSchema,
	})
	.strict();

// ---- Resume ----

export const resumeAgentRequestSchema = z.object({
	workspaceId: z.string().min(1),
	message: z.string().min(1).max(8192),
});
export type ResumeAgentRequest = z.infer<typeof resumeAgentRequestSchema>;

export interface ResumeAgentResponse {
	ok: true;
	messageId: string;
}
