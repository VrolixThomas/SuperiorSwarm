import type React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { CommentsOverviewTab } from "../build-real/CommentsOverviewTab";
import { PROverviewPane } from "../build-real/PROverviewPane";
import { RepoFileTree } from "../build-real/RepoFileTree";
import { AddRepoButton } from "../build/AddRepoButton";
import { AppWindow } from "../build/AppWindow";
import { CodeEditor } from "../build/CodeEditor";
import { DiffView } from "../build/DiffView";
import { MainPane } from "../build/MainPane";
import { PaneColumn } from "../build/PaneColumn";
import { RepoCard } from "../build/RepoCard";
import { RightPanel } from "../build/RightPanel";
import { Sidebar, type SidebarSeg } from "../build/Sidebar";
import type { TabKind } from "../build/TabBar";
import { TerminalBody, type TerminalLine } from "../build/TerminalBody";
import { TicketsBoard } from "../build/TicketsBoard";
import { TicketsSidebarContent } from "../build/TicketsSidebarContent";
import { WorktreeRow } from "../build/WorktreeRow";
import { C } from "../build/colors";
import { ACTS_V3, SPRING_V3, beatEntryFrameV3, beatStartAbsV3 } from "./timeline";

const WINDOW_W = 1820; // wider than v2 (1620) — push toward edge-to-edge
const WINDOW_H = 1000; // taller
const SIDEBAR_W = 280;
const RIGHT_W = 340;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const T_TICKETS = beatStartAbsV3("tickets");
const T_WORKSPACE = beatStartAbsV3("workspace");
const T_WORKTREES = beatStartAbsV3("worktrees");
const T_SPLIT = beatStartAbsV3("splitPane");
const T_REVIEW = beatStartAbsV3("prReview");
const T_SOLVE = beatStartAbsV3("solve");
const T_BUILD_END = ACTS_V3.build.from + ACTS_V3.build.durationInFrames;

const REPO_LIST = [
	{ key: "ss", name: "SuperiorSwarm", entryDelay: 0 },
	{ key: "mcp", name: "mcp-lab", entryDelay: 60 },
	{ key: "skills", name: "agent-skills", entryDelay: 80 },
	{ key: "prompts", name: "prompt-registry", entryDelay: 100 },
];

const WORKTREES_SS = [
	{ key: "main", branch: "main" },
	{ key: "terminal", branch: "feat/agent-terminal-chat", active: true },
	{ key: "mcp", branch: "feat/mcp-server-registry" },
	{ key: "solver", branch: "fix/pr-comment-resolver" },
	{ key: "tickets", branch: "feat/linear-jira-sync" },
	{ key: "macos", branch: "release/macos-onboarding" },
];

const SOLVE_LINES: TerminalLine[] = [
	{ t: "> claude --solve --pr 214", from: 0, c: C.textSecondary },
	{ t: "", from: 4 },
	{
		t: "Reading review comments on #214 · feat/agent-terminal-chat...",
		from: 12,
		c: C.textTertiary,
	},
	{ t: "", from: 22 },
	{ t: "Group 1/4 · Unsubscribe stream on terminal close", from: 28 },
	{ t: "  Applying fix → useAgentTerminalStream.ts", from: 38, c: C.textTertiary },
	{
		t: "✓ d8f3a2b — fix(stream): cancel terminal subscriptions",
		from: 54,
		c: C.termGreen,
		bold: true,
	},
	{ t: "", from: 62 },
	{ t: "Group 2/4 · Pass theme through to xterm", from: 70 },
	{ t: "  Applying fix → Terminal.tsx", from: 80, c: C.textTertiary },
	{ t: "✓ b41c082 — feat(terminal): theme-aware palette", from: 96, c: C.termGreen, bold: true },
	{ t: "", from: 104 },
	{ t: "Group 3/4 · Stable MCP server identifiers", from: 112 },
	{ t: "  Applying fix → mcp-server-registry.ts", from: 122, c: C.textTertiary },
	{ t: "✓ 7e2a195 — fix(mcp): preserve server identity", from: 138, c: C.termGreen, bold: true },
	{ t: "", from: 146 },
	{ t: "Group 4/4 · Add tests for terminal cleanup", from: 154 },
	{ t: "✓ f1d3c4e — test(terminal): cover cleanup paths", from: 174, c: C.termGreen, bold: true },
	{ t: "", from: 182 },
	{ t: "✓ 4 groups pushed · 4 commits", from: 190, c: C.termGreen, bold: true },
	{ t: ">", from: 200, c: C.textSecondary, bold: true },
];

export function WorkspaceV3() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	if (frame < ACTS_V3.build.from || frame >= T_BUILD_END) return null;

	const inTickets = frame >= T_TICKETS && frame < T_WORKSPACE;
	const inWorkspace = frame >= T_WORKSPACE && frame < T_WORKTREES;
	const inWorktrees = frame >= T_WORKTREES && frame < T_SPLIT;
	const inSplit = frame >= T_SPLIT && frame < T_REVIEW;
	const inReview = frame >= T_REVIEW && frame < T_SOLVE;
	const inSolve = frame >= T_SOLVE && frame < T_BUILD_END;

	const sidebarOpenAmt = clamp01(
		spring({ frame: frame - T_TICKETS, fps, config: SPRING_V3, from: 0, to: 1 })
	);

	// Right diff panel: opens at splitPane, closes at solve.
	const rightOpenAmt = interpolate(
		frame,
		[T_SPLIT, T_SPLIT + 40, T_SOLVE - 24, T_SOLVE],
		[0, 1, 1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
	);

	// MainPane split: opens at splitPane, closes at solve start.
	const splitSpring = clamp01(
		spring({ frame: frame - T_SPLIT, fps, config: SPRING_V3, from: 0, to: 1 })
	);
	const splitTimeline = interpolate(
		frame,
		[T_SPLIT, T_SPLIT + 30, T_SOLVE - 24, T_SOLVE],
		[0, 1, 1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
	);
	const splitOpenAmt = clamp01(splitSpring * splitTimeline);

	const sidebarLiveW = SIDEBAR_W * sidebarOpenAmt;
	const rightLiveW = RIGHT_W * rightOpenAmt;

	const sidebarSegment: SidebarSeg = inTickets ? "tickets" : "repos";
	const visibleSegs: SidebarSeg[] = frame >= T_TICKETS ? ["repos", "tickets", "prs"] : [];

	const reposOpacity = inTickets ? 0 : 1;

	// MainPane left tabs.
	const leftTabs: { id: string; kind: TabKind; title: string }[] = [];
	let leftActiveId = "swarm";

	if (inSolve) {
		leftTabs.push({ id: "solve", kind: "terminal", title: "claude · solve #214" });
		leftActiveId = "solve";
	} else if (inReview) {
		leftTabs.push({ id: "swarm", kind: "terminal", title: "SuperiorSwarm" });
		leftTabs.push({ id: "review", kind: "review", title: "Review · #214" });
		leftActiveId = "review";
	} else {
		leftTabs.push({ id: "swarm", kind: "terminal", title: "SuperiorSwarm" });
		leftActiveId = "swarm";
	}

	const rightPaneTabs: { id: string; kind: TabKind; title: string }[] = [];
	if (inSolve) {
		// no split during solve — terminal owns the frame
	} else if (inReview) {
		rightPaneTabs.push({ id: "pr-overview", kind: "review", title: "PR · #214" });
	} else if (inSplit) {
		rightPaneTabs.push({
			id: "use-agent-terminal-stream",
			kind: "file",
			title: "useAgentTerminalStream.ts",
		});
	}

	let leftContent: React.ReactNode = <TerminalBody startFrame={-12} />;
	if (inSolve) {
		leftContent = <TerminalBody startFrame={T_SOLVE - 30} lines={SOLVE_LINES} />;
	} else if (inReview) {
		leftContent = <DiffView entryFrame={T_REVIEW - 40} />;
	}

	let rightPaneContent: React.ReactNode = null;
	if (inReview) {
		rightPaneContent = <PROverviewPane />;
	} else if (inSplit) {
		rightPaneContent = <CodeEditor entryFrame={T_SPLIT + 18} variant="use-agent-terminal-stream" />;
	}

	const rightPaneVisible = splitOpenAmt > 0.02 && rightPaneTabs.length > 0;

	let rightPanelContent: React.ReactNode = null;
	let rightPanelTab: "changes" | "files" | "comments" | "fixes" = "files";
	if (inReview) {
		rightPanelTab = "comments";
		rightPanelContent = <CommentsOverviewTab />;
	} else if (inSplit) {
		rightPanelTab = "files";
		rightPanelContent = <RepoFileTree />;
	}

	const liveAgentCount = inWorkspace || inWorktrees || inSplit || inReview || inSolve ? 3 : 0;

	return (
		<AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
			<AppWindow width={WINDOW_W} height={WINDOW_H} agentCount={liveAgentCount}>
				{sidebarLiveW > 0 && (
					<div style={{ width: sidebarLiveW, height: "100%", overflow: "hidden", flexShrink: 0 }}>
						<div style={{ width: SIDEBAR_W, height: "100%" }}>
							<Sidebar
								width={SIDEBAR_W}
								height={WINDOW_H - 52}
								activeSegment={sidebarSegment}
								visibleSegments={visibleSegs}
							>
								{inTickets ? (
									<TicketsSidebarContent entryFrame={T_TICKETS + 12} />
								) : (
									<div style={{ opacity: reposOpacity, paddingTop: 8 }}>
										{REPO_LIST.map((r, i) => {
											const repoEntry =
												i === 0
													? beatEntryFrameV3("workspace")
													: beatEntryFrameV3("workspace") + r.entryDelay;
											const isActive = i === 0;
											const expanded = isActive && frame >= T_WORKTREES + 8;
											return (
												<div key={r.key}>
													<RepoCard
														name={r.name}
														entryFrame={repoEntry}
														expanded={expanded}
														active={isActive}
													/>
													{expanded && isActive && (
														<div style={{ marginTop: 2, marginBottom: 4 }}>
															{WORKTREES_SS.map((w, wi) => {
																const wEntry = beatEntryFrameV3("worktrees") + 10 + wi * 6;
																const swarmEntry = w.active
																	? beatEntryFrameV3("worktrees") + 36
																	: undefined;
																const statusEntry = w.active
																	? beatEntryFrameV3("worktrees") + 52
																	: undefined;
																return (
																	<WorktreeRow
																		key={w.key}
																		branch={w.branch}
																		entryFrame={wEntry}
																		active={!!w.active}
																		inActiveProject
																		swarmEntryFrame={swarmEntry}
																		statusEntryFrame={statusEntry}
																	/>
																);
															})}
														</div>
													)}
												</div>
											);
										})}
										<AddRepoButton opacity={reposOpacity} />
									</div>
								)}
							</Sidebar>
						</div>
					</div>
				)}

				{inTickets ? (
					<div style={{ flex: 1, height: "100%", overflow: "hidden" }}>
						<TicketsBoard entryFrame={T_TICKETS + 12} />
					</div>
				) : (
					<MainPane
						left={
							<PaneColumn tabs={leftTabs} activeId={leftActiveId}>
								{leftContent}
							</PaneColumn>
						}
						right={
							rightPaneVisible ? (
								<PaneColumn
									tabs={rightPaneTabs}
									activeId={rightPaneTabs[0]?.id ?? "use-agent-terminal-stream"}
								>
									{rightPaneContent}
								</PaneColumn>
							) : undefined
						}
						splitOpenAmt={splitOpenAmt}
					/>
				)}

				{rightLiveW > 0 && (
					<div style={{ width: rightLiveW, height: "100%", overflow: "hidden", flexShrink: 0 }}>
						<div style={{ width: RIGHT_W, height: "100%" }}>
							<RightPanel width={RIGHT_W} activeTab={rightPanelTab}>
								{rightPanelContent}
							</RightPanel>
						</div>
					</div>
				)}
			</AppWindow>
		</AbsoluteFill>
	);
}
