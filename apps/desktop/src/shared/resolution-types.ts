export interface ResolutionSession {
	id: string;
	workspaceId: string;
	prProvider: "github" | "bitbucket";
	prIdentifier: string;
	commitShaBefore: string;
	status: "running" | "done" | "failed";
	createdAt: string;
	updatedAt: string;
	groups: ResolutionGroup[];
	comments: ResolutionComment[];
}

export interface ResolutionGroup {
	id: string;
	sessionId: string;
	commitSha: string;
	commitMessage: string;
	status: "applied" | "reverted";
	createdAt: string;
	comments: ResolutionComment[];
}

export interface ResolutionComment {
	id: string;
	groupId: string | null;
	sessionId: string;
	platformCommentId: string;
	platformThreadId: string | null;
	filePath: string | null;
	lineNumber: number | null;
	author: string;
	body: string;
	status: "resolved" | "skipped" | "pending";
	skipReason: string | null;
}

export interface ReviewCommentFromPlatform {
	platformCommentId: string;
	platformThreadId: string | null;
	author: string;
	body: string;
	filePath: string | null;
	lineNumber: number | null;
}
