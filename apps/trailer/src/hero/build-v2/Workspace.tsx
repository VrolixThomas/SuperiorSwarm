import type React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BranchChanges } from "../build-real/BranchChanges";
import { CommentsOverviewTab } from "../build-real/CommentsOverviewTab";
import { CommittedStack } from "../build-real/CommittedStack";
import { DraftCommitCard } from "../build-real/DraftCommitCard";
import { PRBranchChangesRail } from "../build-real/PRBranchChangesRail";
import { PROverviewPane } from "../build-real/PROverviewPane";
import { PullRequestsTab } from "../build-real/PullRequestsTab";
import { RepoFileTree } from "../build-real/RepoFileTree";
import { SmartHeaderBar } from "../build-real/SmartHeaderBar";
import { SolveReviewTab } from "../build-real/SolveReviewTab";
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
import { ChaosV2 } from "./ChaosV2";
import { ACTS_V2, SPRING_V2, beatEntryFrameV2, beatStartAbsV2 } from "./timeline";

const WINDOW_W = 1620;
const WINDOW_H = 900;
const SIDEBAR_W = 280;
const RIGHT_W = 340;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const T_BUILD = ACTS_V2.build.from;
const T_SIDEBAR = beatStartAbsV2("sidebar");
const T_WORKTREES = beatStartAbsV2("worktrees");
const T_RIGHT = beatStartAbsV2("rightDiff");
const T_SPLIT = beatStartAbsV2("splitPane");
const T_RIGHTCHANGES = beatStartAbsV2("rightChanges");
const T_REVIEW = beatStartAbsV2("review");
const T_SOLVER = beatStartAbsV2("commentsSolve");
const T_TICKETS = beatStartAbsV2("tickets");
const T_PRS = beatStartAbsV2("prs");
const T_REVEAL = ACTS_V2.reveal.from;

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
	{ t: "  return the unsubscribe handle from useEffect", from: 36, c: C.textTertiary },
	{ t: "  Applying fix → useAgentTerminalStream.ts", from: 46, c: C.textTertiary },
	{
		t: "✓ d8f3a2b — fix(stream): cancel terminal subscriptions",
		from: 60,
		c: C.termGreen,
		bold: true,
	},
	{ t: "", from: 70 },
	{ t: "Group 2/4 · Pass theme through to xterm", from: 78 },
	{ t: "  forward theme prop to Terminal", from: 86, c: C.textTertiary },
	{ t: "  Applying fix → Terminal.tsx", from: 96, c: C.textTertiary },
	{ t: "✓ b41c082 — feat(terminal): theme-aware palette", from: 110, c: C.termGreen, bold: true },
	{ t: "", from: 120 },
	{ t: "Group 3/4 · Stable MCP server identifiers", from: 128 },
	{ t: "  derive id from name + version, not refresh counter", from: 136, c: C.textTertiary },
	{ t: "  Applying fix → mcp-server-registry.ts", from: 146, c: C.textTertiary },
	{ t: "✓ 7e2a195 — fix(mcp): preserve server identity", from: 160, c: C.termGreen, bold: true },
	{ t: "", from: 170 },
	{ t: "Group 4/4 · Add tests for terminal cleanup", from: 178 },
	{ t: "  cover unmount + sessionId change", from: 186, c: C.textTertiary },
	{ t: "✓ f1d3c4e — test(terminal): cover cleanup paths", from: 200, c: C.termGreen, bold: true },
	{ t: "", from: 210 },
	{ t: "✓ 4 groups pushed · 4 commits", from: 218, c: C.termGreen, bold: true },
	{ t: ">", from: 230, c: C.textSecondary, bold: true },
];

export function WorkspaceV2() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const inFiles = frame >= T_RIGHT && frame < T_SPLIT;
	const inFileSplit = frame >= T_SPLIT && frame < T_RIGHTCHANGES;
	const inRightChanges = frame >= T_RIGHTCHANGES && frame < T_REVIEW;
	const inReview = frame >= T_REVIEW && frame < T_SOLVER;
	const inSolver = frame >= T_SOLVER && frame < T_TICKETS;
	const inTickets = frame >= T_TICKETS && frame < T_PRS;
	const inPrs = frame >= T_PRS;

	const sidebarOpenAmt = clamp01(
		spring({ frame: frame - T_SIDEBAR, fps, config: SPRING_V2, from: 0, to: 1 })
	);

	// Right diff panel: opens at rightDiff, closes at solver (SolveReviewTab
	// inside MainPane takes over the right-side review affordance), stays
	// closed for tickets, reopens at prs to show the PR branch-changes rail.
	const rightOpenAmt = interpolate(
		frame,
		[T_RIGHT, T_RIGHT + 50, T_SOLVER - 24, T_SOLVER, T_PRS - 24, T_PRS, T_REVEAL],
		[0, 1, 1, 0, 0, 1, 1],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
	);

	// MainPane split: opens at splitPane, stays open through review + solver,
	// closes at tickets, reopens at prs (DiffView left + PROverviewPane right).
	const splitSpring = clamp01(
		spring({ frame: frame - T_SPLIT, fps, config: SPRING_V2, from: 0, to: 1 })
	);
	const splitTimeline = interpolate(
		frame,
		[T_SPLIT, T_SPLIT + 30, T_TICKETS - 24, T_TICKETS, T_PRS - 24, T_PRS, T_REVEAL],
		[0, 1, 1, 0, 0, 1, 1],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
	);
	const splitOpenAmt = clamp01(splitSpring * splitTimeline);

	const sidebarLiveW = SIDEBAR_W * sidebarOpenAmt;
	const rightLiveW = RIGHT_W * rightOpenAmt;

	const scale = interpolate(
		frame,
		[T_BUILD, T_SIDEBAR, T_RIGHT, T_SPLIT + 40, T_REVEAL],
		[0.78, 0.8, 0.82, 0.82, 0.82],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
	);

	const sidebarSegment: SidebarSeg = inPrs ? "prs" : inTickets ? "tickets" : "repos";
	const visibleSegs: SidebarSeg[] =
		frame >= T_TICKETS - 30 ? ["repos", "tickets", "prs"] : frame >= T_SIDEBAR ? ["repos"] : [];

	const reposOpacity = interpolate(frame, [T_TICKETS - 16, T_TICKETS], [1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	// MainPane left tabs.
	const leftTabs: { id: string; kind: TabKind; title: string }[] = [];
	let leftActiveId = "swarm";

	if (inPrs) {
		leftTabs.push({
			id: "use-agent-terminal-stream",
			kind: "file",
			title: "useAgentTerminalStream.ts · renderer/hooks",
		});
		leftActiveId = "use-agent-terminal-stream";
	} else if (inSolver) {
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

	// MainPane right tabs (inside the split column).
	const rightPaneTabs: { id: string; kind: TabKind; title: string }[] = [];
	if (inPrs) {
		rightPaneTabs.push({ id: "pr-overview", kind: "review", title: "PR · #214" });
	} else if (inSolver) {
		rightPaneTabs.push({ id: "solve-review", kind: "review", title: "Solve Review" });
	} else if (inFileSplit || inRightChanges || inReview) {
		rightPaneTabs.push({
			id: "use-agent-terminal-stream",
			kind: "file",
			title: "useAgentTerminalStream.ts · renderer/hooks",
		});
	}

	// MainPane left content.
	let leftContent: React.ReactNode = <TerminalBody startFrame={-12} />;
	if (inPrs) {
		leftContent = <DiffView entryFrame={T_PRS - 40} />;
	} else if (inSolver) {
		leftContent = <TerminalBody startFrame={T_SOLVER - 30} lines={SOLVE_LINES} />;
	} else if (inReview) {
		leftContent = <DiffView entryFrame={T_REVIEW - 40} />;
	}

	// MainPane right content.
	let rightPaneContent: React.ReactNode = null;
	if (inPrs) {
		rightPaneContent = <PROverviewPane />;
	} else if (inSolver) {
		rightPaneContent = <SolveReviewTab />;
	} else if (inFileSplit || inRightChanges || inReview) {
		rightPaneContent = <CodeEditor entryFrame={T_SPLIT + 18} variant="use-agent-terminal-stream" />;
	}

	const rightPaneVisible = splitOpenAmt > 0.02 && !inTickets && rightPaneTabs.length > 0;

	// Right diff panel content (changes/files/comments tabs).
	let rightPanelContent: React.ReactNode = null;
	let rightPanelTab: "changes" | "files" | "comments" | "fixes" = "files";
	if (inReview) {
		rightPanelTab = "comments";
		rightPanelContent = <CommentsOverviewTab />;
	} else if (inRightChanges) {
		rightPanelTab = "changes";
		rightPanelContent = (
			<div style={{ height: "100%", overflowY: "auto" }}>
				<SmartHeaderBar currentBranch="feat/agent-terminal-chat" baseBranch="main" />
				<DraftCommitCard />
				<div style={{ marginTop: 12 }}>
					<BranchChanges />
				</div>
				<div style={{ marginTop: 4, marginBottom: 16 }}>
					<CommittedStack />
				</div>
			</div>
		);
	} else if (inFileSplit || inFiles) {
		rightPanelTab = "files";
		rightPanelContent = <RepoFileTree />;
	} else if (inPrs) {
		rightPanelTab = "changes";
		rightPanelContent = <PRBranchChangesRail />;
	}

	const showChaos = frame < ACTS_V2.collapse.from + ACTS_V2.collapse.durationInFrames + 10; // overlap into build by 10f

	return (
		<AbsoluteFill>
			{showChaos && <ChaosV2 />}
			<AbsoluteFill
				style={{
					alignItems: "center",
					justifyContent: "center",
					transform: `scale(${scale})`,
				}}
			>
				<AppWindow width={WINDOW_W} height={WINDOW_H} agentCount={3}>
					{sidebarLiveW > 0 && (
						<div
							style={{
								width: sidebarLiveW,
								height: "100%",
								overflow: "hidden",
								flexShrink: 0,
							}}
						>
							<div style={{ width: SIDEBAR_W, height: "100%" }}>
								<Sidebar
									width={SIDEBAR_W}
									height={WINDOW_H - 52}
									activeSegment={sidebarSegment}
									visibleSegments={visibleSegs}
								>
									{inPrs ? (
										<PullRequestsTab />
									) : inTickets ? (
										<TicketsSidebarContent entryFrame={T_TICKETS + 12} />
									) : (
										<div style={{ opacity: reposOpacity, paddingTop: 8 }}>
											{REPO_LIST.map((r, i) => {
												const repoEntry =
													i === 0
														? beatEntryFrameV2("sidebar")
														: beatEntryFrameV2("reposCascade") + r.entryDelay;
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
																	const wEntry = beatEntryFrameV2("worktrees") + 10 + wi * 6;
																	const swarmEntry = w.active
																		? beatEntryFrameV2("agentBadges") + 8
																		: undefined;
																	const statusEntry = w.active
																		? beatEntryFrameV2("agentBadges") + 22
																		: undefined;
																	const swarmFlip = w.active ? T_REVIEW + 260 : undefined;
																	const statusFlip = w.active ? T_REVIEW + 240 : undefined;
																	return (
																		<WorktreeRow
																			key={w.key}
																			branch={w.branch}
																			entryFrame={wEntry}
																			active={!!w.active}
																			inActiveProject
																			swarmEntryFrame={swarmEntry}
																			statusEntryFrame={statusEntry}
																			swarmFlipToDoneAt={swarmFlip}
																			statusFlipToDoneAt={statusFlip}
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
						<div
							style={{
								width: rightLiveW,
								height: "100%",
								overflow: "hidden",
								flexShrink: 0,
							}}
						>
							<div style={{ width: RIGHT_W, height: "100%" }}>
								<RightPanel width={RIGHT_W} activeTab={rightPanelTab}>
									{rightPanelContent}
								</RightPanel>
							</div>
						</div>
					)}
				</AppWindow>
			</AbsoluteFill>
		</AbsoluteFill>
	);
}
