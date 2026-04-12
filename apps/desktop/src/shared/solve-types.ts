export type SolveSessionStatus =
	| "queued"
	| "in_progress"
	| "ready"
	| "submitted"
	| "failed"
	| "dismissed"
	| "cancelled";

export type SolveGroupStatus = "pending" | "fixed" | "approved" | "submitted" | "reverted";

export type SolveCommentStatus = "open" | "fixed" | "unclear" | "wont_fix" | "changes_requested";

export type SolveReplyStatus = "draft" | "approved" | "posted";

export interface ChangedFile {
	path: string;
	changeType: "A" | "M" | "D" | "R";
	additions: number;
	deletions: number;
}

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
	lastActivityAt: Date | null;
	groups: SolveGroupInfo[];
}

export interface SolveGroupInfo {
	id: string;
	label: string;
	status: SolveGroupStatus;
	commitHash: string | null;
	order: number;
	changedFiles: ChangedFile[];
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
	followUpText: string | null;
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
