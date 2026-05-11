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

// ---- Messages ----

export const messageKindSchema = z.enum(["note", "question", "answer"]);
export type MessageKindInput = z.infer<typeof messageKindSchema>;

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
	fromWorkspaceId: string;
	toWorkspaceId: string | null;
	kind: "resume" | "note" | "question" | "answer" | "broadcast";
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
