import { useCurrentFrame } from "remotion";
import { TerminalBody } from "../../build/TerminalBody";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../RepoSidebarV4";
import { finishOrder } from "../agentOrder";
import { useColorsV4 } from "../colors-v4";
import { REPOS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

export function WithActiveWorkspaces() {
	const c = useColorsV4();
	const frame = useCurrentFrame();

	const worktrees = REPOS_V4[0]?.worktrees ?? [];
	// "main" (index 0) never runs an agent. Branches 1..n are the active set.
	const activeIndexes = worktrees.map((_, i) => i).filter((i) => i > 0);
	const orderOnFinish = finishOrder(activeIndexes.length);

	const startFrame = SCENES_V4.s3StartWS.from;
	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => {
		if (i === 0) return null;
		const activePos = activeIndexes.indexOf(i);
		const entryFrame = startFrame + activePos * 15;
		if (frame < entryFrame) return null;
		const finishSlot = orderOnFinish.indexOf(activePos);
		const finishFrame = SCENES_V4.s4AgentsDone.from + finishSlot * 60;
		return frame >= finishFrame ? "done" : "active";
	});

	return (
		<>
			<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} />
			<div style={{ flex: 1, background: c.bgBase }}>
				<TerminalBody startFrame={SCENES_V4.s3StartWS.from} />
			</div>
		</>
	);
}
