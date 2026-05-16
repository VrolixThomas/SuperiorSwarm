import { interpolate, useCurrentFrame } from "remotion";
import { BranchChanges } from "../../build-real/BranchChanges";
import { CommittedStack } from "../../build-real/CommittedStack";
import { DiffPanelHeader } from "../../build-real/DiffPanelHeader";
import { DraftCommitCard } from "../../build-real/DraftCommitCard";
import { SmartHeaderBar } from "../../build-real/SmartHeaderBar";
import { CodeEditor } from "../../build/CodeEditor";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../RepoSidebarV4";
import { useColorsV4 } from "../colors-v4";
import { REPOS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const RIGHT_PANEL_TARGET_W = 420;
const ACTIVE_BRANCH = "feat/agent-terminal-chat";

export function WithRightPanelChanges() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s5DiffPanel.from;

	const rightW = interpolate(local, [0, 24], [0, RIGHT_PANEL_TARGET_W], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	// Keep s4 alert state — all done by this scene.
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
				<CodeEditor entryFrame={SCENES_V4.s5DiffPanel.from} variant="use-agent-terminal-stream" />
			</div>

			<div
				style={{
					width: rightW,
					flexShrink: 0,
					overflow: "hidden",
					background: c.bgSurface,
					borderLeft: `1px solid ${c.borderSubtle}`,
				}}
			>
				<div
					style={{
						width: RIGHT_PANEL_TARGET_W,
						height: "100%",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
					}}
				>
					<DiffPanelHeader activeTab="changes" />
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
			</div>
		</>
	);
}
