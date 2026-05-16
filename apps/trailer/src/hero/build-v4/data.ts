import type { TerminalLine } from "../build/TerminalBody";

export interface WorktreeV4 {
	branch: string;
	lastActivity: string;
}

export interface RepoV4 {
	name: string;
	worktrees: WorktreeV4[];
}

export interface TicketV4 {
	id: string;
	title: string;
	state: "todo" | "in-progress" | "done";
}

export interface PRCommentV4 {
	author: string;
	body: string;
	file: string;
	line: number;
}

export interface PRV4 {
	number: number;
	title: string;
	author: string;
	role: "incoming-review" | "outgoing-needs-review";
	comments: PRCommentV4[];
}

export interface DiffHunkV4 {
	startLine: number;
	deletions: string[];
	additions: string[];
}

export interface DemoFileV4 {
	path: string;
	language: string;
	hunks: DiffHunkV4[];
}

export type OpeningTerminalKind = "swarm" | "claude" | "codex" | "gemini";

export interface OpeningTerminalV4 {
	kind: OpeningTerminalKind;
	label: string;
	lines: TerminalLine[];
}

export const REPOS_V4: RepoV4[] = [
	{
		name: "SuperiorSwarm",
		worktrees: [
			{ branch: "main", lastActivity: "2m ago" },
			{ branch: "MarketingImages", lastActivity: "12m ago" },
			{ branch: "feature/auth-refactor", lastActivity: "1h ago" },
			{ branch: "fix/repo-watcher", lastActivity: "3h ago" },
			{ branch: "feature/ticket-drag", lastActivity: "5h ago" },
			{ branch: "chore/biome-config", lastActivity: "1d ago" },
			{ branch: "release/0.7.3", lastActivity: "2d ago" },
			{ branch: "wip/lsp-settings", lastActivity: "3d ago" },
		],
	},
	{
		name: "acme-api",
		worktrees: [
			{ branch: "main", lastActivity: "30m ago" },
			{ branch: "feature/rate-limit", lastActivity: "2h ago" },
			{ branch: "fix/cors-preflight", lastActivity: "1d ago" },
		],
	},
	{
		name: "acme-mobile",
		worktrees: [
			{ branch: "main", lastActivity: "1h ago" },
			{ branch: "feature/push-notifications", lastActivity: "4h ago" },
		],
	},
];

export const TICKETS_V4: TicketV4[] = [
	{ id: "SS-142", title: "Stale review badges in PR list", state: "todo" },
	{ id: "SS-148", title: "Tickets tab drag handle drifts", state: "todo" },
	{ id: "SS-151", title: "MCP server reconnect loop on sleep", state: "in-progress" },
	{ id: "SS-153", title: "Settings shortcut overlaps with sidebar", state: "todo" },
	{ id: "SS-157", title: "Worktree picker should sort by recency", state: "todo" },
];

export const PRS_V4: PRV4[] = [
	{
		number: 142,
		title: "fix: dedupe terminal PTY events",
		author: "jess",
		role: "incoming-review",
		comments: [
			{
				author: "jess",
				body: "Can we extract this dedupe into a hook so the worktree picker can use it too?",
				file: "src/main/terminal/pty-events.ts",
				line: 47,
			},
			{
				author: "jess",
				body: "Type assertion here is suspicious — should we narrow the union instead?",
				file: "src/main/terminal/pty-events.ts",
				line: 92,
			},
		],
	},
	{
		number: 148,
		title: "feat: drag-to-reorder tickets",
		author: "thomas",
		role: "outgoing-needs-review",
		comments: [
			{
				author: "marko",
				body: "Drag preview position drifts when sidebar is collapsed.",
				file: "src/renderer/components/TicketsBoard.tsx",
				line: 134,
			},
			{
				author: "marko",
				body: "Persist order to db on drag end, not on hover.",
				file: "src/renderer/components/TicketsBoard.tsx",
				line: 218,
			},
			{
				author: "marko",
				body: "Add a keyboard alternative for accessibility.",
				file: "src/renderer/components/TicketsBoard.tsx",
				line: 260,
			},
		],
	},
	{
		number: 151,
		title: "fix: MCP reconnect on sleep wake",
		author: "marko",
		role: "incoming-review",
		comments: [
			{
				author: "marko",
				body: "I think we want exponential backoff here, not a fixed delay.",
				file: "src/main/mcp/reconnect.ts",
				line: 31,
			},
		],
	},
	{
		number: 153,
		title: "feat: settings shortcut",
		author: "thomas",
		role: "outgoing-needs-review",
		comments: [
			{
				author: "jess",
				body: "Conflicts with the existing cmd+, on macOS — different namespace?",
				file: "src/renderer/actions/core-actions.ts",
				line: 78,
			},
			{
				author: "jess",
				body: "Add this to the keyboard shortcuts settings page.",
				file: "src/renderer/components/settings/SettingsNav.tsx",
				line: 22,
			},
		],
	},
];

export const DEMO_FILES_V4: DemoFileV4[] = [
	{
		path: "src/main/git/repo-watcher.ts",
		language: "typescript",
		hunks: [
			{
				startLine: 14,
				deletions: ['import chokidar from "chokidar";'],
				additions: [
					'import chokidar from "chokidar";',
					"// Use v3 for fsevents binding — v4 leaks file handles on macOS",
				],
			},
			{
				startLine: 48,
				deletions: ["\tignoreInitial: true,"],
				additions: ["\tignoreInitial: true,", "\tusePolling: false,", "\tatomic: true,"],
			},
		],
	},
	{
		path: "src/renderer/components/TicketsBoard.tsx",
		language: "typescript",
		hunks: [
			{
				startLine: 132,
				deletions: ["\tconst handleDrag = (e: DragEvent) => {"],
				additions: [
					"\tconst handleDrag = (e: DragEvent) => {",
					"\t\tif (!sidebarExpanded) return offsetDrag(e, sidebarWidth);",
				],
			},
		],
	},
	{
		path: "src/main/mcp/reconnect.ts",
		language: "typescript",
		hunks: [
			{
				startLine: 29,
				deletions: ["\t\tawait sleep(1000);", "\t\treturn this.connect();"],
				additions: [
					"\t\tawait sleep(this.backoffMs);",
					"\t\tthis.backoffMs = Math.min(this.backoffMs * 2, 30_000);",
					"\t\treturn this.connect();",
				],
			},
		],
	},
];

// Each tile runs ~5-7 seconds of scripted output. Frames inside `lines` are local
// to the tile (TerminalBody's startFrame prop normalizes them).
const swarmLines = (label: string): TerminalLine[] => [
	{ t: `> ${label}`, from: 0, c: "#8e8e93" },
	{ t: "", from: 6 },
	{ t: "Reading files...", from: 18, c: "#8e8e93" },
	{ t: "Found target. Drafting changes...", from: 48 },
	{ t: "+ const next = prev.filter(unique);", from: 90, c: "#69db7c" },
	{ t: "- const next = prev.unique();", from: 108, c: "#ff6b6b" },
	{ t: "Writing src/main/...", from: 138, c: "#8e8e93" },
	{ t: "✓ type-check passed", from: 180, c: "#69db7c", bold: true },
	{ t: "✓ tests 12/12", from: 210, c: "#69db7c", bold: true },
	{ t: ">", from: 240, c: "#8e8e93", bold: true },
];

export const OPENING_TERMINALS_V4: OpeningTerminalV4[] = [
	{ kind: "swarm", label: "auth-refactor", lines: swarmLines("auth-refactor") },
	{ kind: "swarm", label: "migration-runner", lines: swarmLines("migration-runner") },
	{ kind: "swarm", label: "pty-dedup", lines: swarmLines("pty-dedup") },
	{ kind: "swarm", label: "review-pr-142", lines: swarmLines("review-pr-142") },
	{ kind: "swarm", label: "rebuild-graph", lines: swarmLines("rebuild-graph") },
	{
		kind: "claude",
		label: "claude code",
		lines: [
			{ t: "> claude code -p 'fix the lint errors'", from: 0, c: "#8e8e93" },
			{ t: "Analyzing 12 files...", from: 30, c: "#8e8e93" },
			{ t: "Found 4 errors, 2 warnings", from: 78 },
			{ t: "Applying fixes...", from: 120, c: "#8e8e93" },
			{ t: "✓ done", from: 180, c: "#69db7c", bold: true },
		],
	},
	{
		kind: "codex",
		label: "codex",
		lines: [
			{ t: "> codex exec 'add type hints'", from: 0, c: "#8e8e93" },
			{ t: "scanning python files...", from: 30, c: "#8e8e93" },
			{ t: "annotating 8 modules", from: 78 },
			{ t: "✓ patch applied", from: 156, c: "#69db7c", bold: true },
		],
	},
	{
		kind: "gemini",
		label: "gemini chat",
		lines: [
			{ t: "> gemini chat", from: 0, c: "#8e8e93" },
			{ t: "user: review this diff", from: 30 },
			{ t: "model: 3 issues, 2 nits", from: 90, c: "#74c0fc" },
			{ t: "model: I'd extract the retry...", from: 150, c: "#74c0fc" },
		],
	},
];
