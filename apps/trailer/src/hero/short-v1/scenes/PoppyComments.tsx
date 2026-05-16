// PoppyComments — 4s scene. Compositions reuses v4 SolveReviewTab (which has
// its own card-stamp animation) and v4 RightPanelV4 in comments mode, but the
// container reveals are orchestrated per-region to give the scene multiple
// visible entry beats instead of a single slide.
//
// Layout: sidebar (past-built) | center solve review | right comments panel.

import type { ReactNode } from "react";
import { Sequence } from "remotion";
import { SolveReviewTab } from "../../build-real/SolveReviewTab";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../../build-v4/RepoSidebarV4";
import { RightPanelV4 } from "../../build-v4/RightPanelV4";
import { REPOS_V4 } from "../../build-v4/data";
import { SCENES_V4 } from "../../build-v4/timeline";
import { Pop } from "../Pop";

const ACTIVE_BRANCH = "feat/agent-terminal-chat";
const SIDEBAR_PAST = SCENES_V4.s2SidebarBuild.from + SCENES_V4.s2SidebarBuild.duration;

interface Props {
	tabBar?: ReactNode;
}

export function PoppyComments({ tabBar }: Props) {
	const worktrees = REPOS_V4[0]?.worktrees ?? [];
	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => (i === 0 ? null : "done"));

	return (
		<>
			<Sequence from={-SIDEBAR_PAST} layout="none">
				<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} activeBranch={ACTIVE_BRANCH} />
			</Sequence>

			<div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
				<Pop variant="fadeIn" delay={0} duration={10}>
					{tabBar}
				</Pop>
				<Pop variant="slideUp" delay={6} duration={16} style={{ flex: 1, minHeight: 0 }}>
					<SolveReviewTab />
				</Pop>
			</div>

			<Pop
				variant="slideLeft"
				delay={4}
				duration={18}
				style={{ width: 420, flexShrink: 0, height: "100%" }}
			>
				<RightPanelV4 mode="comments" />
			</Pop>
		</>
	);
}
