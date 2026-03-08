// apps/desktop/src/shared/github-types.ts

export interface GitHubPRContext {
	owner: string;
	repo: string;
	number: number;
	title: string;
	sourceBranch: string;
	targetBranch: string;
	repoPath: string;
}

export interface GitHubReviewComment {
	id: string;
	body: string;
	author: string;
	authorAvatarUrl: string;
	createdAt: string;
}

export interface GitHubReviewThread {
	id: string;
	isResolved: boolean;
	path: string;
	line: number | null;
	diffSide: "LEFT" | "RIGHT";
	comments: GitHubReviewComment[];
}

export interface GitHubCheckRun {
	name: string;
	status: string;
	conclusion: string | null;
	detailsUrl: string | null;
}

export interface GitHubReviewer {
	login: string;
	avatarUrl: string;
	decision: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING" | null;
}

export interface GitHubPRFile {
	path: string;
	additions: number;
	deletions: number;
	changeType: "ADDED" | "MODIFIED" | "DELETED" | "RENAMED" | "COPIED" | "CHANGED" | "UNCHANGED";
}

export interface GitHubConversationComment {
	id: string;
	body: string;
	author: string;
	authorAvatarUrl: string;
	createdAt: string;
}

export interface GitHubPRDetails {
	title: string;
	body: string;
	state: "OPEN" | "CLOSED" | "MERGED";
	isDraft: boolean;
	author: string;
	authorAvatarUrl: string;
	reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
	ciState: "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL" | null;
	checks: GitHubCheckRun[];
	reviewers: GitHubReviewer[];
	reviewThreads: GitHubReviewThread[];
	conversationComments: GitHubConversationComment[];
	files: GitHubPRFile[];
	sourceBranch: string;
	targetBranch: string;
	headCommitOid: string;
}
