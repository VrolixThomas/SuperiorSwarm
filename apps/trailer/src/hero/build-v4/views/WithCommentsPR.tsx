import { CommentsOverviewTab } from "../../build-real/CommentsOverviewTab";
import { DiffPanelHeader } from "../../build-real/DiffPanelHeader";
import { CodeEditor } from "../../build/CodeEditor";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../RepoSidebarV4";
import { useColorsV4 } from "../colors-v4";
import { REPOS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const RIGHT_PANEL_W = 440;
const ACTIVE_BRANCH = "feat/agent-terminal-chat";

export function WithCommentsPR() {
	const c = useColorsV4();

	const worktrees = REPOS_V4[0]?.worktrees ?? [];
	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => (i === 0 ? null : "done"));

	return (
		<>
			<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} activeBranch={ACTIVE_BRANCH} />

			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
				<CodeEditor entryFrame={SCENES_V4.s7PRComment.from} variant="use-agent-terminal-stream" />
			</div>

			{/* Right: full DiffPanel chrome with Comments tab active */}
			<div
				style={{
					width: RIGHT_PANEL_W,
					flexShrink: 0,
					background: c.bgSurface,
					borderLeft: `1px solid ${c.borderSubtle}`,
					overflow: "hidden",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<DiffPanelHeader activeTab="comments" />
				<div style={{ flex: 1, overflow: "hidden" }}>
					<CommentsOverviewTab />
				</div>
			</div>
		</>
	);
}
