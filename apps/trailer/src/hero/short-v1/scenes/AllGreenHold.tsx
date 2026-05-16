// allGreenHold beat. Sidebar fully green (all worktrees done). Quiet beauty
// shot with subtle global pulse to show "this is the goal state" before outro.

import { interpolate, useCurrentFrame } from "remotion";
import { TerminalBody } from "../../build/TerminalBody";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../../build-v4/RepoSidebarV4";
import { RightPanelV4 } from "../../build-v4/RightPanelV4";
import { useColorsV4 } from "../../build-v4/colors-v4";
import { REPOS_V4 } from "../../build-v4/data";

const ACTIVE_BRANCH = "feat/agent-terminal-chat";

export function AllGreenHold() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const worktrees = REPOS_V4[0]?.worktrees ?? [];

	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => (i === 0 ? null : "done"));

	// 0.7Hz subtle pulse on opacity, very gentle.
	const pulse = 0.97 + 0.03 * Math.sin((frame / 60) * Math.PI * 1.4);

	return (
		<div style={{ display: "flex", width: "100%", height: "100%", opacity: pulse }}>
			<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} activeBranch={ACTIVE_BRANCH} />
			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					opacity: interpolate(frame, [0, 30], [0.6, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					}),
				}}
			>
				<div style={{ flex: 1, minHeight: 0 }}>
					<TerminalBody startFrame={0} />
				</div>
			</div>
			<RightPanelV4 mode="changes" />
		</div>
	);
}
