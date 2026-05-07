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
}

export interface CreateWorkspaceResponse {
	workspaceId: string;
	worktreeId: string;
	path: string;
	branch: string;
	baseBranch: string;
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

export type RemoveWorkspaceStatus = "removed" | "cancelled-by-user" | "blocked-uncommitted";

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
