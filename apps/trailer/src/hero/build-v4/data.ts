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

// Mirrors build-v2/v3 REPO_LIST + WORKTREES_SS so the sidebar shows the same
// repos across all trailer builds. SuperiorSwarm is the expanded repo; the
// other three appear collapsed.
export const REPOS_V4: RepoV4[] = [
	{
		name: "SuperiorSwarm",
		worktrees: [
			{ branch: "main" },
			{ branch: "feat/agent-terminal-chat" },
			{ branch: "feat/mcp-server-registry" },
			{ branch: "fix/pr-comment-resolver" },
			{ branch: "feat/linear-jira-sync" },
			{ branch: "release/macos-onboarding" },
		],
	},
	{ name: "mcp-lab", worktrees: [] },
	{ name: "agent-skills", worktrees: [] },
	{ name: "prompt-registry", worktrees: [] },
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

// Each tile has its own scripted output so the 8-tile grid doesn't read as
// monotonous lockstep. Pacing, line counts, color mix, and prompt style vary
// per tile to suggest each agent is genuinely running independently.
export const OPENING_TERMINALS_V4: OpeningTerminalV4[] = [
	// Fast / clean: boots, writes, done in ~3s.
	{
		kind: "swarm",
		label: "auth-refactor",
		lines: [
			{ t: "> auth-refactor", from: 0, c: "#8e8e93" },
			{ t: "Reading src/main/auth/...", from: 12, c: "#8e8e93" },
			{ t: "+ token = await refresh(session);", from: 42, c: "#69db7c" },
			{ t: "- token = session.token;", from: 54, c: "#ff6b6b" },
			{ t: "✓ tests 18/18", from: 96, c: "#69db7c", bold: true },
			{ t: ">", from: 150, c: "#8e8e93", bold: true },
		],
	},
	// Slow stream: many "running N of M" lines.
	{
		kind: "swarm",
		label: "migration-runner",
		lines: [
			{ t: "> migration-runner", from: 0, c: "#8e8e93" },
			{ t: "Detected 12 pending migrations", from: 18 },
			{ t: "  → 0007_add_workspace_index.sql", from: 36, c: "#8e8e93" },
			{ t: "  → 0008_split_review_threads.sql", from: 54, c: "#8e8e93" },
			{ t: "  → 0009_add_solve_sessions.sql", from: 72, c: "#8e8e93" },
			{ t: "  → 0010_index_pr_status.sql", from: 90, c: "#8e8e93" },
			{ t: "  → 0011_add_review_drafts.sql", from: 108, c: "#8e8e93" },
			{ t: "  → 0012_normalize_ticket_state.sql", from: 126, c: "#8e8e93" },
			{ t: "Applying batch (12)...", from: 156 },
			{ t: "✓ migrated 12/12 in 1.8s", from: 216, c: "#69db7c", bold: true },
		],
	},
	// Mixed: finds bug, stacktrace-style red, then green.
	{
		kind: "swarm",
		label: "pty-dedup",
		lines: [
			{ t: "> pty-dedup", from: 0, c: "#8e8e93" },
			{ t: "Reproducing duplicate-output bug...", from: 18, c: "#8e8e93" },
			{ t: "FAIL  src/daemon/pty.test.ts > emits each line once", from: 60, c: "#ff6b6b" },
			{ t: "  expected 4 emits, got 8", from: 78, c: "#ff6b6b" },
			{ t: "  at PtyDaemon.flush (pty.ts:142)", from: 90, c: "#ff6b6b" },
			{ t: "Patching ring-buffer drain...", from: 132, c: "#8e8e93" },
			{ t: "✓ tests 6/6", from: 192, c: "#69db7c", bold: true },
		],
	},
	// Pauses in the middle (waiting for token), then bursts.
	{
		kind: "swarm",
		label: "review-pr-214",
		lines: [
			{ t: "> review-pr-214", from: 0, c: "#8e8e93" },
			{ t: "Fetching diff for PR #214...", from: 24, c: "#8e8e93" },
			{ t: "Waiting for GitHub token...", from: 72, c: "#ffd43b" },
			{ t: "✓ token refreshed", from: 144, c: "#69db7c" },
			{ t: "Analyzing 3 changed files", from: 162 },
			{ t: "3 suggestions, 1 nit", from: 198, c: "#74c0fc" },
		],
	},
	// Heavy IO: long file paths streaming.
	{
		kind: "swarm",
		label: "rebuild-graph",
		lines: [
			{ t: "> rebuild-graph", from: 0, c: "#8e8e93" },
			{ t: "Indexing apps/desktop/src/...", from: 18, c: "#8e8e93" },
			{ t: "  components/Sidebar.tsx", from: 36, c: "#8e8e93" },
			{ t: "  components/DiffPanel.tsx", from: 48, c: "#8e8e93" },
			{ t: "  components/CommentsOverviewTab.tsx", from: 60, c: "#8e8e93" },
			{ t: "  components/solve/SolveSidebar.tsx", from: 72, c: "#8e8e93" },
			{ t: "  components/tickets/TicketsBoardView.tsx", from: 84, c: "#8e8e93" },
			{ t: "  hooks/useAgentTerminalStream.ts", from: 96, c: "#8e8e93" },
			{ t: "✓ 184 nodes · 412 edges", from: 168, c: "#69db7c", bold: true },
		],
	},
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
