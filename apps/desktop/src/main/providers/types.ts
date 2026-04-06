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
	filePath?: string;
	line?: number;
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

// ── Provider interfaces ─────────────────────────────────────────────────────

export interface GitProvider {
	readonly name: "github" | "bitbucket";

	isConnected(): boolean;

	getMyPRs(): Promise<NormalizedPR[]>;
	getPRState(owner: string, repo: string, prNumber: number): Promise<PRState>;

	getPRComments(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<NormalizedComment[]>;
	createInlineComment(params: CreateCommentParams): Promise<{ id: string }>;
	replyToComment(params: ReplyParams): Promise<{ id: string }>;
	resolveComment(params: ResolveParams): Promise<void>;
	unresolveComment(params: ResolveParams): Promise<void>;
}

export interface IssueTracker {
	readonly name: "jira" | "linear";

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
