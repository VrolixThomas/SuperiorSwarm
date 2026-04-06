import type { GitHubPRDetails } from "../../shared/github-types";

// ── Normalized types ────────────────────────────────────────────────────────

export interface NormalizedPR {
	id: number;
	title: string;
	state: "open" | "closed" | "merged" | "declined";
	author: string;
	webUrl: string;
	sourceBranch: string;
	targetBranch: string;
	role: "author" | "reviewer";
	repoOwner: string;
	repoName: string;
}

export interface PRState {
	headSha: string;
	state: "open" | "closed" | "merged" | "declined";
}

export interface NormalizedComment {
	id: string;
	body: string;
	author: string;
	filePath: string | null;
	lineNumber: number | null;
	createdAt: string;
}

export interface NormalizedIssue {
	id: string;
	identifier: string;
	title: string;
	url: string;
	status: string;
	statusCategory: string;
	statusColor: string;
}

export interface NormalizedIssueDetail {
	description: string;
	comments: Array<{
		id: string;
		author: string;
		avatarUrl?: string;
		body: string;
		createdAt: string;
	}>;
}

export interface NormalizedState {
	id: string;
	name: string;
}

// ── Parameter types ─────────────────────────────────────────────────────────

export interface CreateCommentParams {
	owner: string;
	repo: string;
	prNumber: number;
	body: string;
	commitId?: string;
	filePath?: string;
	line?: number;
	side?: "LEFT" | "RIGHT";
}

export interface ReplyParams {
	owner: string;
	repo: string;
	prNumber: number;
	commentId: string;
	body: string;
}

export interface ResolveParams {
	owner: string;
	repo: string;
	prNumber: number;
	commentId: string;
}

export interface NormalizedPRFile {
	path: string;
	status: "added" | "modified" | "removed" | "renamed";
	previousPath?: string;
}

export interface NormalizedReviewThread {
	nodeId: string;
	isResolved: boolean;
}

export interface SubmitReviewParams {
	owner: string;
	repo: string;
	prNumber: number;
	verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
	body: string;
}

// ── Provider interfaces ─────────────────────────────────────────────────────

export interface GitProvider {
	readonly name: string;

	isConnected(): boolean;

	getMyPRs(): Promise<NormalizedPR[]>;
	getPRState(owner: string, repo: string, prNumber: number): Promise<PRState>;

	getPRComments(owner: string, repo: string, prNumber: number): Promise<NormalizedComment[]>;
	createInlineComment(params: CreateCommentParams): Promise<{ id: string; nodeId?: string }>;
	replyToComment(params: ReplyParams): Promise<{ id: string }>;
	resolveComment(params: ResolveParams): Promise<void>;
	unresolveComment(params: ResolveParams): Promise<void>;

	submitReview(params: SubmitReviewParams): Promise<void>;
	getPRFiles(owner: string, repo: string, prNumber: number): Promise<NormalizedPRFile[]>;
	getReviewThreads(
		owner: string,
		repo: string,
		prNumber: number
	): Promise<NormalizedReviewThread[]>;
	getPRDetails(owner: string, repo: string, prNumber: number): Promise<GitHubPRDetails>;
}

export interface IssueTracker {
	readonly name: string;

	isConnected(): boolean;

	getAssignedIssues(options?: {
		includeDone?: boolean;
		teamId?: string;
	}): Promise<NormalizedIssue[]>;
	getIssueDetail(issueId: string): Promise<NormalizedIssueDetail>;
	getAvailableStates(context: {
		issueId?: string;
		teamId?: string;
	}): Promise<NormalizedState[]>;
	updateIssueState(issueId: string, stateId: string): Promise<void>;
}
