// agentsFlip beat. Drives RepoSidebarV4 alerts directly at 10f/agent for
// hit-hit-hit cadence (v4's WithActiveWorkspaces flips at 60f/agent — too slow
// for shortform). Sidebar shows all worktrees active at scene start; dots flip
// "done" rapid-fire from top to bottom.

import { useCurrentFrame } from "remotion";
import { TerminalBody } from "../../build/TerminalBody";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../../build-v4/RepoSidebarV4";
import { RightPanelV4 } from "../../build-v4/RightPanelV4";
import { useColorsV4 } from "../../build-v4/colors-v4";
import { REPOS_V4 } from "../../build-v4/data";

const FLIP_SPACING = 10;
const FLIP_START = 18;
const ACTIVE_BRANCH = "feat/agent-terminal-chat";

interface Props {
	// Inner-clock frame at which this scene's flip cascade starts. Required
	// because the enclosing shifted Sequence places useCurrentFrame at a v4
	// anchor (~1200) so RepoSidebarV4's build-window past-check passes.
	startFrame: number;
}

export function AgentsDoneFastScene({ startFrame }: Props) {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - startFrame;
	const worktrees = REPOS_V4[0]?.worktrees ?? [];

	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => {
		if (i === 0) return null;
		const flipAt = FLIP_START + (i - 1) * FLIP_SPACING;
		return local >= flipAt ? "done" : "active";
	});

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
				<div style={{ flex: 1, minHeight: 0 }}>
					<TerminalBody startFrame={startFrame} />
				</div>
			</div>
			<RightPanelV4 mode="changes" />
		</>
	);
}
