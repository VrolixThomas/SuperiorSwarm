import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { AppWindow } from "../build/AppWindow";
import { PaneColumn } from "../build/PaneColumn";
import { TerminalBody, type TerminalLine } from "../build/TerminalBody";
import { C } from "../build/colors";

const WINDOW_W = 1620;
const WINDOW_H = 900;
const SCALE = 0.62;

interface GhostPos {
	x: number;
	y: number;
	rot: number;
	entry: number;
}

const GHOSTS: GhostPos[] = [
	{ x: -1240, y: -460, rot: -7, entry: 0 },
	{ x: 1180, y: -520, rot: 6, entry: 6 },
	{ x: -1340, y: 420, rot: -5, entry: 12 },
	{ x: 1240, y: 480, rot: 8, entry: 18 },
	{ x: -380, y: -660, rot: -3, entry: 24 },
	{ x: 420, y: 680, rot: 4, entry: 30 },
];

const LINES_CLAUDE_TERMINAL_CHAT: TerminalLine[] = [
	{ t: "> claude --resume", from: 0, c: C.textSecondary },
	{ t: "", from: 4 },
	{ t: "Claude Code v0.2.14", from: 10, bold: true },
	{ t: "Workspace: SuperiorSwarm · feat/agent-terminal-chat", from: 18, c: C.textTertiary },
	{ t: "", from: 24 },
	{ t: "> Fix stream cleanup in agent terminal chat", from: 28, c: C.textSecondary },
	{ t: "Reading src/renderer/hooks/useAgentTerminalStream.ts...", from: 42, c: C.textTertiary },
	{ t: "- streamRef.current = stream.subscribe(handler);", from: 60, c: C.termRed },
	{ t: "+ const sub = stream.subscribe(handler);", from: 72, c: C.termGreen },
	{ t: "+ return () => sub.unsubscribe();", from: 82, c: C.termGreen },
	{ t: "✓ bun run type-check passed (0 errors)", from: 96, c: C.termGreen, bold: true },
	{ t: ">", from: 110, c: C.textSecondary, bold: true },
];

const LINES_CODEX_MCP_REGISTRY: TerminalLine[] = [
	{ t: "> codex run", from: 0, c: C.textSecondary },
	{ t: "", from: 4 },
	{ t: "Codex CLI v1.4.2", from: 10, bold: true },
	{ t: "Workspace: mcp-lab · feat/mcp-server-registry", from: 18, c: C.textTertiary },
	{ t: "", from: 24 },
	{ t: "> Register custom MCP server presets", from: 30, c: C.textSecondary },
	{ t: "Scanning mcp-standalone/src/registry.ts...", from: 44, c: C.textTertiary },
	{ t: "+ export const PRESETS: McpPreset[] = [", from: 60, c: C.termGreen },
	{ t: "+   { id: 'github', cmd: 'mcp-github' },", from: 72, c: C.termGreen },
	{ t: "+   { id: 'linear', cmd: 'mcp-linear' },", from: 82, c: C.termGreen },
	{ t: "✓ 3 presets registered", from: 98, c: C.termGreen, bold: true },
	{ t: ">", from: 112, c: C.textSecondary, bold: true },
];

const LINES_AIDER_RETRY_HELPER: TerminalLine[] = [
	{ t: "> aider --yes", from: 0, c: C.textSecondary },
	{ t: "", from: 4 },
	{ t: "aider v0.62.1", from: 10, bold: true },
	{ t: "Workspace: agent-skills · feat/skills-retry-helper", from: 18, c: C.textTertiary },
	{ t: "", from: 24 },
	{ t: "> Extract retry helper from skill runners", from: 30, c: C.textSecondary },
	{ t: "Editing src/skills/retry.ts...", from: 44, c: C.textTertiary },
	{ t: "- for (let i = 0; i < 3; i++) { try { ... } }", from: 60, c: C.termRed },
	{ t: "+ return withRetry(fn, { attempts: 3 });", from: 72, c: C.termGreen },
	{ t: "Applied to 4 call sites.", from: 86 },
	{ t: "✓ tests pass (24/24)", from: 100, c: C.termGreen, bold: true },
	{ t: ">", from: 114, c: C.textSecondary, bold: true },
];

const LINES_CLAUDE_RENAME_VARS: TerminalLine[] = [
	{ t: "> claude --resume", from: 0, c: C.textSecondary },
	{ t: "", from: 4 },
	{ t: "Claude Code v0.2.14", from: 10, bold: true },
	{ t: "Workspace: prompt-registry · chore/rename-vars", from: 18, c: C.textTertiary },
	{ t: "", from: 24 },
	{ t: "> Rename prompt template variables", from: 30, c: C.textSecondary },
	{ t: "Searching {{user_msg}}, {{sys_msg}} across templates...", from: 44, c: C.textTertiary },
	{ t: "- {{user_msg}} {{sys_msg}}", from: 60, c: C.termRed },
	{ t: "+ {{userMessage}} {{systemMessage}}", from: 72, c: C.termGreen },
	{ t: "Updated 18 files across templates/", from: 86 },
	{ t: "✓ biome check passed", from: 100, c: C.termGreen, bold: true },
	{ t: ">", from: 114, c: C.textSecondary, bold: true },
];

const LINES_CODEX_PR_COMMENTS: TerminalLine[] = [
	{ t: "> codex review", from: 0, c: C.textSecondary },
	{ t: "", from: 4 },
	{ t: "Codex CLI v1.4.2", from: 10, bold: true },
	{ t: "Workspace: SuperiorSwarm · fix/pr-comment-resolver", from: 18, c: C.textTertiary },
	{ t: "", from: 24 },
	{ t: "> Resolve PR #214 review comments", from: 30, c: C.textSecondary },
	{ t: "Fetching pull/214 threads...", from: 44, c: C.textTertiary },
	{ t: "Comment: 'Cancel stream when terminal closes'", from: 58 },
	{
		t: "✓ Committed d8f3a2 — fix(stream): cancel subscriptions",
		from: 74,
		c: C.termGreen,
		bold: true,
	},
	{ t: "Comment: 'Keep MCP server names stable'", from: 88 },
	{ t: "✓ Committed a4b261 — fix(mcp): preserve identity", from: 104, c: C.termGreen, bold: true },
	{ t: ">", from: 118, c: C.textSecondary, bold: true },
];

const LINES_AIDER_LINEAR_SYNC: TerminalLine[] = [
	{ t: "> aider --yes", from: 0, c: C.textSecondary },
	{ t: "", from: 4 },
	{ t: "aider v0.62.1", from: 10, bold: true },
	{ t: "Workspace: SuperiorSwarm · feat/linear-jira-sync", from: 18, c: C.textTertiary },
	{ t: "", from: 24 },
	{ t: "> Sync Linear status on merge", from: 30, c: C.textSecondary },
	{ t: "Editing src/main/integrations/linear-sync.ts...", from: 44, c: C.textTertiary },
	{ t: "+ await linear.updateIssue(id, { stateId: DONE });", from: 60, c: C.termGreen },
	{ t: "+ logger.info('linear: marked done', { id });", from: 72, c: C.termGreen },
	{ t: "Wired into mergeHandler webhook.", from: 86 },
	{ t: "✓ integration tests pass (8/8)", from: 100, c: C.termGreen, bold: true },
	{ t: ">", from: 114, c: C.textSecondary, bold: true },
];

interface GhostContent {
	tabId: string;
	tabTitle: string;
	lines: TerminalLine[];
	startFrame: number;
}

const GHOST_CONTENT: GhostContent[] = [
	{
		tabId: "claude",
		tabTitle: "claude · feat/agent-terminal-chat",
		lines: LINES_CLAUDE_TERMINAL_CHAT,
		startFrame: -12,
	},
	{
		tabId: "codex",
		tabTitle: "codex · feat/mcp-server-registry",
		lines: LINES_CODEX_MCP_REGISTRY,
		startFrame: -18,
	},
	{
		tabId: "aider",
		tabTitle: "aider · feat/skills-retry-helper",
		lines: LINES_AIDER_RETRY_HELPER,
		startFrame: -24,
	},
	{
		tabId: "claude",
		tabTitle: "claude · chore/rename-vars",
		lines: LINES_CLAUDE_RENAME_VARS,
		startFrame: -30,
	},
	{
		tabId: "codex",
		tabTitle: "codex · fix/pr-comment-resolver",
		lines: LINES_CODEX_PR_COMMENTS,
		startFrame: -36,
	},
	{
		tabId: "aider",
		tabTitle: "aider · feat/linear-jira-sync",
		lines: LINES_AIDER_LINEAR_SYNC,
		startFrame: -42,
	},
];

export function ChaosV2() {
	const frame = useCurrentFrame();

	const collapseT = interpolate(frame, [280, 460], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const layerOpacity = interpolate(frame, [380, 470], [1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	if (frame >= 470) return null;

	return (
		<AbsoluteFill
			style={{
				alignItems: "center",
				justifyContent: "center",
				opacity: layerOpacity,
				pointerEvents: "none",
			}}
		>
			{GHOSTS.map((g, i) => {
				const entryOp = interpolate(frame, [g.entry, g.entry + 18], [0, 1], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				const tx = g.x * (1 - collapseT);
				const ty = g.y * (1 - collapseT);
				const rot = g.rot * (1 - collapseT);
				const content = GHOST_CONTENT[i];
				if (!content) return null;
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static positions
						key={i}
						style={{
							position: "absolute",
							transform: `translate3d(${tx}px, ${ty}px, 0) rotate(${rot}deg) scale(${SCALE})`,
							opacity: entryOp,
						}}
					>
						<AppWindow width={WINDOW_W} height={WINDOW_H} agentCount={3}>
							<PaneColumn
								tabs={[{ id: content.tabId, kind: "terminal", title: content.tabTitle }]}
								activeId={content.tabId}
							>
								<TerminalBody startFrame={content.startFrame} lines={content.lines} />
							</PaneColumn>
						</AppWindow>
					</div>
				);
			})}
		</AbsoluteFill>
	);
}
