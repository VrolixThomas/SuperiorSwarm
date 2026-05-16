// s6FileNav repurposed as "keyboard-nav demo" inside the Review tab. Same
// layout as WithRightPanelChanges (s5); the visible difference is that the
// in-tab j-key pulse keeps cycling files at a faster cadence here so the
// reader registers the keyboard-driven flow.

import { BranchChanges } from "../../build-real/BranchChanges";
import { CommittedStack } from "../../build-real/CommittedStack";
import { DraftCommitCard } from "../../build-real/DraftCommitCard";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../RepoSidebarV4";
import { useColorsV4 } from "../colors-v4";
import { REPOS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";
import { ReviewTabV4 } from "./ReviewTabV4";

const RIGHT_PANEL_W = 420;
const ACTIVE_BRANCH = "feat/agent-terminal-chat";

export function WithFileNav() {
	const c = useColorsV4();

	const worktrees = REPOS_V4[0]?.worktrees ?? [];
	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => (i === 0 ? null : "done"));

	// Pass s5's entryFrame so ReviewTabV4's selection cycle continues seamlessly
	// across s5→s6 — the j-key pulse keeps stepping files instead of resetting.
	return (
		<>
			<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} activeBranch={ACTIVE_BRANCH} />

			<ReviewTabV4
				entryFrame={SCENES_V4.s5DiffPanel.from}
				currentBranch={ACTIVE_BRANCH}
				baseBranch="main"
			/>

			<div
				style={{
					width: RIGHT_PANEL_W,
					flexShrink: 0,
					overflow: "hidden",
					background: c.bgSurface,
					borderLeft: `1px solid ${c.borderSubtle}`,
					display: "flex",
					flexDirection: "column",
				}}
			>
				<div style={{ flex: 1, overflowY: "auto" }}>
					<DraftCommitCard />
					<div style={{ marginTop: 12 }}>
						<BranchChanges />
					</div>
					<div style={{ marginTop: 4, marginBottom: 16 }}>
						<CommittedStack />
					</div>
				</div>
			</div>
		</>
	);
}
