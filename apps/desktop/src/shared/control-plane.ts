import { z } from "zod";

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
	projectId: z.string().min(1),
	workspaceId: z.string().min(1),
});
export type GetWorkspaceRequest = z.infer<typeof getWorkspaceRequestSchema>;

export const dispatchAgentRequestSchema = z.object({
	projectId: z.string().min(1),
	workspaceId: z.string().min(1),
	prompt: z.string().min(1),
	cliPreset: z.enum(["claude", "codex", "gemini", "opencode"]).optional(),
	skipPermissions: z.boolean().optional(),
});
export type DispatchAgentRequest = z.infer<typeof dispatchAgentRequestSchema>;

export const removeWorkspaceRequestSchema = z.object({
	projectId: z.string().min(1),
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
	type: "branch" | "worktree" | "review";
	name: string;
	branch: string | null;
	worktreePath: string | null;
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
	worktreeId: string;
	path: string;
	branch: string;
	baseBranch: string;
	createdAt: Date;
	updatedAt: Date;
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

// ---- Memory ----

export const memoryFtsKindSchema = z.enum(["goal", "decision", "question", "journal"]);

export const memoryAddGoalRequestSchema = z.object({
	title: z.string().min(1).max(500),
	body: z.string().max(8192).nullish(),
});
export type MemoryAddGoalRequest = z.infer<typeof memoryAddGoalRequestSchema>;

export const memoryListGoalsRequestSchema = z.object({
	status: z.enum(["active", "done", "abandoned"]).optional(),
});
export type MemoryListGoalsRequest = z.infer<typeof memoryListGoalsRequestSchema>;

export const memoryAddFollowupRequestSchema = z.object({
	title: z.string().min(1).max(500),
	body: z.string().max(8192).nullish(),
	owner: z.string().max(200).nullish(),
	dueAt: z.string().datetime().nullish(),
	goalId: z.string().nullish(),
});
export type MemoryAddFollowupRequest = z.infer<typeof memoryAddFollowupRequestSchema>;

export const memoryListFollowupsRequestSchema = z.object({
	status: z.enum(["open", "done", "cancelled"]).optional(),
	owner: z.string().optional(),
	dueBefore: z.string().datetime().optional(),
	dueAfter: z.string().datetime().optional(),
});
export type MemoryListFollowupsRequest = z.infer<typeof memoryListFollowupsRequestSchema>;

export const memoryLogDecisionRequestSchema = z.object({
	title: z.string().min(1).max(500),
	rationale: z.string().min(1).max(8192),
	alternatives: z.string().max(8192).nullish(),
});
export type MemoryLogDecisionRequest = z.infer<typeof memoryLogDecisionRequestSchema>;

export const memoryListDecisionsRequestSchema = z.object({
	since: z.string().datetime().optional(),
	limit: z.number().int().min(1).max(500).optional(),
});
export type MemoryListDecisionsRequest = z.infer<typeof memoryListDecisionsRequestSchema>;

export const memoryAddQuestionRequestSchema = z.object({
	question: z.string().min(1).max(2000),
	context: z.string().max(8192).nullish(),
});
export type MemoryAddQuestionRequest = z.infer<typeof memoryAddQuestionRequestSchema>;

export const memoryAnswerQuestionRequestSchema = z.object({
	id: z.string().min(1),
	answer: z.string().min(1).max(8192),
});
export type MemoryAnswerQuestionRequest = z.infer<typeof memoryAnswerQuestionRequestSchema>;

export const memoryListQuestionsRequestSchema = z.object({
	status: z.enum(["open", "answered", "stale"]).optional(),
});
export type MemoryListQuestionsRequest = z.infer<typeof memoryListQuestionsRequestSchema>;

export const memoryJournalStartRequestSchema = z.object({});
export type MemoryJournalStartRequest = z.infer<typeof memoryJournalStartRequestSchema>;

export const memoryJournalAppendRequestSchema = z.object({
	sessionId: z.string().min(1),
	text: z.string().min(1),
});
export type MemoryJournalAppendRequest = z.infer<typeof memoryJournalAppendRequestSchema>;

export const memoryJournalEndRequestSchema = z.object({
	sessionId: z.string().min(1),
	summary: z.string().min(1).max(8192),
});
export type MemoryJournalEndRequest = z.infer<typeof memoryJournalEndRequestSchema>;

export const memoryReadJournalRequestSchema = z.object({
	sessionId: z.string().min(1),
});
export type MemoryReadJournalRequest = z.infer<typeof memoryReadJournalRequestSchema>;

export const memoryRecentJournalsRequestSchema = z.object({
	limit: z.number().int().min(1).max(100).optional(),
});
export type MemoryRecentJournalsRequest = z.infer<typeof memoryRecentJournalsRequestSchema>;

export const memorySearchRequestSchema = z.object({
	query: z.string().min(1),
	kinds: z.array(memoryFtsKindSchema).optional(),
	limit: z.number().int().min(1).max(100).optional(),
});
export type MemorySearchRequest = z.infer<typeof memorySearchRequestSchema>;
