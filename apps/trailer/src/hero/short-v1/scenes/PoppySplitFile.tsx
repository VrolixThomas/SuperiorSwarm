// PoppySplitFile — 3s scene. Sidebar + BranchActions bar are already there
// from prior scene; the new motion is the split-pane file opening. We
// orchestrate that explicitly: left pane terminal slides up, then a divider
// settles, then the right pane file slides in from the right edge with a
// ringPulse on its tab pill to draw the eye.

import type { ReactNode } from "react";
import { Sequence } from "remotion";
import { TerminalBody } from "../../build/TerminalBody";
import { BranchActionsBarV4 } from "../../build-v4/MainPaneHeaderV4";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../../build-v4/RepoSidebarV4";
import { RightPanelV4 } from "../../build-v4/RightPanelV4";
import { type TabPillV4, WorkspaceTabBarV4 } from "../../build-v4/WorkspaceTabBarV4";
import { useColorsV4 } from "../../build-v4/colors-v4";
import { DEMO_FILES_V4, REPOS_V4 } from "../../build-v4/data";
import { SCENES_V4 } from "../../build-v4/timeline";
import { tokenizeTs } from "../../build-v4/syntax";
import { Pop } from "../Pop";

const ACTIVE_BRANCH = "feat/agent-terminal-chat";
const SIDEBAR_PAST = SCENES_V4.s2SidebarBuild.from + SCENES_V4.s2SidebarBuild.duration;

interface Props {
	tabBar?: ReactNode;
}

export function PoppySplitFile({ tabBar: _tabBar }: Props) {
	const c = useColorsV4();
	const worktrees = REPOS_V4[0]?.worktrees ?? [];
	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => (i === 0 ? null : "done"));
	const file = DEMO_FILES_V4[0];
	const fileName = file?.path.split("/").pop() ?? "useAgentTerminalStream.ts";

	const leftTabs: TabPillV4[] = [{ id: "term-1", title: "Terminal 1", kind: "terminal" }];
	const rightTabs: TabPillV4[] = [{ id: "file-1", title: fileName, kind: "file" }];

	return (
		<>
			<Sequence from={-SIDEBAR_PAST} layout="none">
				<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} activeBranch={ACTIVE_BRANCH} />
			</Sequence>

			<div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
				<Pop variant="slideDown" delay={0} duration={12}>
					<BranchActionsBarV4 />
				</Pop>
				<div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
					{/* Left pane — terminal continued from previous scene context. */}
					<Pop
						variant="slideUp"
						delay={4}
						duration={14}
						style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
					>
						<WorkspaceTabBarV4 tabs={leftTabs} activeTabId="term-1" />
						<div style={{ flex: 1, minHeight: 0 }}>
							<TerminalBody startFrame={0} />
						</div>
					</Pop>

					{/* Right pane — slides in from right edge at delay=40 (~0.7s into
					    scene). Tab pill gets a ringPulse to flag the new pane. */}
					{file && (
						<Pop
							variant="slideLeft"
							delay={40}
							duration={22}
							style={{
								flex: 1,
								display: "flex",
								flexDirection: "column",
								overflow: "hidden",
								borderLeft: `1px solid ${c.borderSubtle}`,
							}}
						>
							<Pop variant="ringPulse" delay={56} duration={22}>
								<WorkspaceTabBarV4 tabs={rightTabs} activeTabId="file-1" />
							</Pop>
							<Pop
								variant="fadeIn"
								delay={62}
								duration={26}
								style={{
									flex: 1,
									minHeight: 0,
									overflowY: "auto",
									padding: "12px 16px",
									fontFamily: "var(--font-mono)",
									fontSize: 11,
									lineHeight: 1.55,
									background: c.bgBase,
								}}
							>
								<FileBody file={file} />
							</Pop>
						</Pop>
					)}
				</div>
			</div>

			<RightPanelV4 mode="changes" />
		</>
	);
}

function FileBody({ file }: { file: (typeof DEMO_FILES_V4)[number] }) {
	const c = useColorsV4();
	const lines: { text: string; lineNo: number }[] = [];
	for (const hunk of file.hunks) {
		let n = hunk.startLine;
		for (const text of hunk.additions) {
			lines.push({ text, lineNo: n });
			n += 1;
			if (lines.length >= 32) break;
		}
		if (lines.length >= 32) break;
	}

	return (
		<div>
			<div
				style={{
					fontSize: 10,
					color: c.textQuaternary,
					marginBottom: 10,
					fontFamily: "var(--font-mono)",
				}}
			>
				{file.path}
			</div>
			{lines.map((l, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: stable list
					key={i}
					style={{ display: "flex", gap: 14, color: c.textSecondary }}
				>
					<span style={{ width: 26, textAlign: "right", color: c.textQuaternary, opacity: 0.6 }}>
						{l.lineNo}
					</span>
					<span style={{ whiteSpace: "pre", flex: 1 }}>
						{tokenizeTs(l.text).map((tok, ti) => (
							<span
								// biome-ignore lint/suspicious/noArrayIndexKey: stable list
								key={ti}
								style={{ color: tok.color }}
							>
								{tok.text}
							</span>
						))}
					</span>
				</div>
			))}
		</div>
	);
}
