// Shared showcase mock data + types for the PR-related panels in the trailer
// (PRControlRail right rail, PROverviewPane center pane).
// Extracted from PRControlRail.tsx so multiple components can render the same PR.

export type ChangeType =
	| "ADDED"
	| "MODIFIED"
	| "DELETED"
	| "RENAMED"
	| "COPIED"
	| "CHANGED"
	| "UNCHANGED";

export type ReviewerDecision = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING";

export interface MockFile {
	path: string;
	additions: number;
	deletions: number;
	changeType: ChangeType;
}

export interface MockReviewer {
	login: string;
	avatarUrl: string | null;
	decision: ReviewerDecision;
}

export interface MockPRDetails {
	number: number;
	title: string;
	author: string;
	owner: string;
	repo: string;
	sourceBranch: string;
	targetBranch: string;
	state: "OPEN" | "CLOSED" | "MERGED";
	isDraft: boolean;
	reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
	ciState: "SUCCESS" | "FAILURE" | "PENDING" | null;
	reviewers: MockReviewer[];
	files: MockFile[];
	commentCount: number;
	resolvedCount: number;
	unresolvedCount: number;
}

export const MOCK_PR: MockPRDetails = {
	number: 214,
	title: "feat: agent terminal chat",
	author: "alex",
	owner: "superiorswarm",
	repo: "superiorswarm",
	sourceBranch: "feat/agent-terminal-chat",
	targetBranch: "main",
	state: "OPEN",
	isDraft: false,
	reviewDecision: "CHANGES_REQUESTED",
	ciState: "FAILURE",
	reviewers: [
		{ login: "sam", avatarUrl: null, decision: "CHANGES_REQUESTED" },
		{ login: "jordan", avatarUrl: null, decision: "PENDING" },
	],
	files: [
		{
			path: "src/renderer/hooks/useAgentTerminalStream.ts",
			additions: 12,
			deletions: 2,
			changeType: "MODIFIED",
		},
		{
			path: "src/renderer/components/terminal/Terminal.tsx",
			additions: 46,
			deletions: 8,
			changeType: "MODIFIED",
		},
		{
			path: "src/renderer/components/terminal/AgentStreamIndicator.tsx",
			additions: 24,
			deletions: 0,
			changeType: "ADDED",
		},
		{
			path: "src/renderer/components/solve/SolveSidebar.tsx",
			additions: 28,
			deletions: 4,
			changeType: "MODIFIED",
		},
		{
			path: "src/renderer/main/ai-review/comment-solver-orchestrator.ts",
			additions: 64,
			deletions: 13,
			changeType: "MODIFIED",
		},
		{
			path: "src/renderer/main/mcp/mcp-server-registry.ts",
			additions: 8,
			deletions: 2,
			changeType: "MODIFIED",
		},
		{
			path: "src/shared/agent-events.ts",
			additions: 18,
			deletions: 2,
			changeType: "MODIFIED",
		},
	],
	commentCount: 3,
	resolvedCount: 1,
	unresolvedCount: 2,
};

export const ACTIVE_FILE_PATH = "src/renderer/hooks/useAgentTerminalStream.ts";

export const VIEWED_FILES = new Set<string>([
	"src/renderer/components/terminal/AgentStreamIndicator.tsx",
	"src/renderer/main/mcp/mcp-server-registry.ts",
	"src/shared/agent-events.ts",
]);

export const COMMENT_COUNT_BY_FILE = new Map<string, number>([
	["src/renderer/hooks/useAgentTerminalStream.ts", 1],
	["src/renderer/components/terminal/Terminal.tsx", 1],
	["src/renderer/main/mcp/mcp-server-registry.ts", 1],
]);

export const CHANGE_TYPE_DOT: Record<string, string> = {
	ADDED: "bg-[var(--term-green)]",
	MODIFIED: "bg-[var(--term-yellow)]",
	DELETED: "bg-[var(--term-red)]",
	RENAMED: "bg-[var(--accent)]",
	COPIED: "bg-[var(--accent)]",
	CHANGED: "bg-[var(--term-yellow)]",
	UNCHANGED: "bg-[var(--text-quaternary)]",
};

export function basename(p: string): string {
	const idx = p.lastIndexOf("/");
	return idx === -1 ? p : p.slice(idx + 1);
}

export function formatPrIdentifier(d: MockPRDetails): string {
	return `${d.owner}/${d.repo}#${d.number}`;
}

// ── Review threads (mirrors GitHubReviewThread for PROverviewPane CommentsFeed) ──

export interface ShowcaseReviewThreadComment {
	id: string;
	author: string;
	createdAtRelative: string;
	body: string;
}

export interface ShowcaseReviewThread {
	id: string;
	filename: string;
	filePath: string;
	line: number;
	isResolved: boolean;
	comments: ShowcaseReviewThreadComment[];
}

export const SHOWCASE_REVIEW_THREADS: ShowcaseReviewThread[] = [
	{
		id: "th-stream",
		filename: "useAgentTerminalStream.ts",
		filePath: "src/renderer/hooks/useAgentTerminalStream.ts",
		line: 42,
		isResolved: false,
		comments: [
			{
				id: "c1",
				author: "sam",
				createdAtRelative: "2h ago",
				body: "Cancel the stream subscription when the terminal closes — we're leaking handlers on unmount.\n\n```\nreturn () => sub.unsubscribe();\n```\n\nThe current useRef approach holds the subscription past unmount.",
			},
		],
	},
	{
		id: "th-stream-2",
		filename: "useAgentTerminalStream.ts",
		filePath: "src/renderer/hooks/useAgentTerminalStream.ts",
		line: 56,
		isResolved: false,
		comments: [
			{
				id: "c2",
				author: "sam",
				createdAtRelative: "2h ago",
				body: "Also make sure the cleanup runs before re-subscribing on sessionId change — otherwise we double-subscribe for one tick.",
			},
		],
	},
	{
		id: "th-mcp",
		filename: "mcp-server-registry.ts",
		filePath: "src/renderer/main/mcp/mcp-server-registry.ts",
		line: 18,
		isResolved: true,
		comments: [
			{
				id: "c3",
				author: "jordan",
				createdAtRelative: "1h ago",
				body: "Keep MCP server names stable across refreshes — id should derive from name + version.",
			},
		],
	},
];
