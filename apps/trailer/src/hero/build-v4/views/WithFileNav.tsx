import { BranchChanges } from "../../build-real/BranchChanges";
import { CommittedStack } from "../../build-real/CommittedStack";
import { DiffPanelHeader } from "../../build-real/DiffPanelHeader";
import { DraftCommitCard } from "../../build-real/DraftCommitCard";
import { RepoFileTree } from "../../build-real/RepoFileTree";
import { SmartHeaderBar } from "../../build-real/SmartHeaderBar";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../RepoSidebarV4";
import { useColorsV4 } from "../colors-v4";
import { REPOS_V4 } from "../data";

const RIGHT_PANEL_W = 420;
const ACTIVE_BRANCH = "feat/agent-terminal-chat";

export function WithFileNav() {
	const c = useColorsV4();

	const worktrees = REPOS_V4[0]?.worktrees ?? [];
	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => (i === 0 ? null : "done"));

	return (
		<>
			<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} activeBranch={ACTIVE_BRANCH} />

			{/* Center: file tree pane (Files tab swap in main area) */}
			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
				<RepoFileTree />
			</div>

			{/* Right: same DiffPanel chrome as s5, Files tab active */}
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
				<DiffPanelHeader activeTab="files" />
				<SmartHeaderBar currentBranch={ACTIVE_BRANCH} baseBranch="main" />
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
