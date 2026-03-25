export type SolveSessionStatus =
	| "queued"
	| "in_progress"
	| "ready"
	| "submitted"
	| "failed"
	| "dismissed";

export type SolveGroupStatus = "pending" | "fixed" | "approved" | "reverted";

export type SolveCommentStatus = "open" | "fixed" | "unclear" | "wont_fix";

export type SolveReplyStatus = "draft" | "approved" | "posted";

export interface SolveSessionInfo {
	id: string;
	prProvider: string;
	prIdentifier: string;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	status: SolveSessionStatus;
	commitSha: string | null;
	workspaceId: string;
	createdAt: Date;
	updatedAt: Date;
	groups: SolveGroupInfo[];
}

export interface SolveGroupInfo {
	id: string;
	label: string;
	status: SolveGroupStatus;
	commitHash: string | null;
	order: number;
	comments: SolveCommentInfo[];
}

export interface SolveCommentInfo {
	id: string;
	platformCommentId: string;
	author: string;
	body: string;
	filePath: string;
	lineNumber: number | null;
	side: string | null;
	threadId: string | null;
	status: SolveCommentStatus;
	commitSha: string | null;
	groupId: string | null;
	reply: SolveReplyInfo | null;
}

export interface SolveReplyInfo {
	id: string;
	body: string;
	status: SolveReplyStatus;
}

export interface SolveLaunchInfo {
	sessionId: string;
	workspaceId: string;
	worktreePath: string;
	launchScript: string;
}
