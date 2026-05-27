import type { ReactNode } from "react";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../RepoSidebarV4";
import { RightPanelV4 } from "../RightPanelV4";
import { REPOS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";
import { ReviewTabV4 } from "./ReviewTabV4";

const ACTIVE_BRANCH = "feat/agent-terminal-chat";

export function WithRightPanelChanges({ tabBar }: { tabBar?: ReactNode }) {
	const worktrees = REPOS_V4[0]?.worktrees ?? [];
	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => (i === 0 ? null : "done"));

	return (
		<>
			<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} activeBranch={ACTIVE_BRANCH} />

			<div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
				{tabBar}
				<ReviewTabV4
					entryFrame={SCENES_V4.s5DiffPanel.from}
					currentBranch={ACTIVE_BRANCH}
					baseBranch="main"
				/>
			</div>

			<RightPanelV4 mode="changes" />
		</>
	);
}
