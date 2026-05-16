import { SCENES_V4 } from "./timeline";

export interface BeatCopyV4 {
	key: string;
	caption: string;
	startFrame: number;
}

// Captions only — no VO. Hold ~3.5s, fade out before next caption.
// Outro renders its own large CTA copy (superiorswarm.com / Download for
// macOS) inside the Outro scene, so no caption is needed there.
export const BEAT_COPY_V4: BeatCopyV4[] = [
	{ key: "opening", caption: "Agents run everywhere.", startFrame: SCENES_V4.opening.from + 90 },
	{ key: "s1", caption: "You watch from one place.", startFrame: SCENES_V4.s1Terminal.from + 30 },
	{
		key: "s2",
		caption: "Every repo. Every worktree.",
		startFrame: SCENES_V4.s2SidebarBuild.from + 60,
	},
	{ key: "s2b", caption: "Light or dark.", startFrame: SCENES_V4.s2bThemeSweep.from + 30 },
	{ key: "s3", caption: "Spin them up at once.", startFrame: SCENES_V4.s3StartWS.from + 30 },
	{ key: "s4", caption: "They finish on their own.", startFrame: SCENES_V4.s4AgentsDone.from + 60 },
	{ key: "s5", caption: "Review the diffs.", startFrame: SCENES_V4.s5DiffPanel.from + 60 },
	{ key: "s6", caption: "Open any file.", startFrame: SCENES_V4.s6FileNav.from + 30 },
	{ key: "s7", caption: "Comments come in.", startFrame: SCENES_V4.s7PRComment.from + 30 },
	{ key: "s8", caption: "Solve them with AI.", startFrame: SCENES_V4.s8SolveResult.from + 60 },
	{ key: "s9", caption: "Pick up a ticket.", startFrame: SCENES_V4.s9Tickets.from + 30 },
	{ key: "s10", caption: "Review what others ship.", startFrame: SCENES_V4.s10PRsList.from + 30 },
];
