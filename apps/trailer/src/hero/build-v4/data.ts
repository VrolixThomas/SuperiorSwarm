import type { TerminalLine } from "../build/TerminalBody";

export interface WorktreeV4 {
	branch: string;
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
			{ branch: "main" },
			{ branch: "MarketingImages" },
			{ branch: "feat/agent-terminal-chat" },
			{ branch: "feature/auth-refactor" },
			{ branch: "fix/repo-watcher" },
			{ branch: "feature/ticket-drag" },
			{ branch: "chore/biome-config" },
			{ branch: "release/0.7.3" },
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

// Aligned to MOCK_PR in build-real/pr-showcase.ts so the same PR (#214 "feat:
// agent terminal chat" by alex) appears consistently across PR scenes.
export const PRS_V4: PRV4[] = [
	{
		number: 214,
		title: "feat: agent terminal chat",
		author: "alex",
		role: "incoming-review",
		comments: [
			{
				author: "sam",
				body: "Cancel the stream subscription when the terminal closes — we're leaking handlers on unmount.",
				file: "src/renderer/hooks/useAgentTerminalStream.ts",
				line: 42,
			},
			{
				author: "sam",
				body: "Also make sure the cleanup runs before re-subscribing on sessionId change — otherwise we double-subscribe for one tick.",
				file: "src/renderer/hooks/useAgentTerminalStream.ts",
				line: 56,
			},
			{
				author: "jordan",
				body: "Keep MCP server names stable across refreshes — id should derive from name + version.",
				file: "src/renderer/main/mcp/mcp-server-registry.ts",
				line: 18,
			},
		],
	},
];

// File paths align with MOCK_PR.files in build-real/pr-showcase.ts so the same
// PR (#214) appears consistently across diff scenes.
export const DEMO_FILES_V4: DemoFileV4[] = [
	{
		path: "src/renderer/hooks/useAgentTerminalStream.ts",
		language: "typescript",
		hunks: [
			{
				startLine: 38,
				deletions: ["\t\tstreamRef.current = stream.subscribe(handler);"],
				additions: [
					"\t\tconst sub = stream.subscribe(handler);",
					"\t\treturn () => sub.unsubscribe();",
				],
			},
			{
				startLine: 54,
				deletions: ["\t}, []);"],
				additions: ["\t}, [sessionId]);"],
			},
		],
	},
	{
		path: "src/renderer/components/terminal/Terminal.tsx",
		language: "typescript",
		hunks: [
			{
				startLine: 84,
				deletions: ["\t<Terminal stream={stream} />"],
				additions: ["\t<Terminal stream={stream} theme={theme} />"],
			},
		],
	},
	{
		path: "src/renderer/main/mcp/mcp-server-registry.ts",
		language: "typescript",
		hunks: [
			{
				startLine: 14,
				deletions: ["\t\tid: crypto.randomUUID(),"],
				additions: ["\t\tid: `${cfg.name}@${cfg.version}`,", "\t\tname: cfg.name,"],
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
	{ kind: "swarm", label: "review-pr-214", lines: swarmLines("review-pr-214") },
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
