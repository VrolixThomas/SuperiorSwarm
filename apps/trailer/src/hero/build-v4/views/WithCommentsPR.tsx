// s7PRComment — Solve Review tab inside the regular workspace shell (left
// repo sidebar + main pane + right changes panel). Same chrome as s5/s6 so
// the viewer stays oriented; only the active tab content changes.

import type { ReactNode } from "react";
import { SolveReviewTab } from "../../build-real/SolveReviewTab";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../RepoSidebarV4";
import { RightPanelV4 } from "../RightPanelV4";
import { REPOS_V4 } from "../data";

const ACTIVE_BRANCH = "feat/agent-terminal-chat";

export function WithCommentsPR({ tabBar }: { tabBar?: ReactNode }) {
	const worktrees = REPOS_V4[0]?.worktrees ?? [];
	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => (i === 0 ? null : "done"));

	return (
		<>
			<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} activeBranch={ACTIVE_BRANCH} />

			<div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
				{tabBar}
				<SolveReviewTab />
			</div>

			<RightPanelV4 mode="comments" />
		</>
	);
}
