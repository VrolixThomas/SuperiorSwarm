import { SCENES_V4 } from "./timeline";

export interface BeatCopyV4 {
	key: string;
	caption: string;
	voiceover: string;
	startFrame: number;
}

// Captions are short on-screen labels. Voiceover lines are rewritten to flow
// as continuous narration (punchier, slightly longer than the caption). VO
// fires at startFrame and is allowed to bleed ~1.5-2s into the next scene.
// Outro gets its own VO that overlaps the CTA card.
export const BEAT_COPY_V4: BeatCopyV4[] = [
	{
		key: "opening",
		caption: "Agents run everywhere.",
		voiceover: "Your AI agents are running everywhere.",
		startFrame: SCENES_V4.opening.from + 90,
	},
	{
		key: "s1",
		caption: "You watch from one place.",
		voiceover: "You watch them from one place.",
		startFrame: SCENES_V4.s1Terminal.from + 30,
	},
	{
		key: "s2",
		caption: "Every repo. Every worktree.",
		voiceover: "Every repo. Every worktree. Side by side.",
		startFrame: SCENES_V4.s2SidebarBuild.from + 60,
	},
	{
		key: "s2b",
		caption: "Light or dark.",
		voiceover: "Light, or dark.",
		startFrame: SCENES_V4.s2bThemeSweep.from + 30,
	},
	{
		key: "s3",
		caption: "Spin them up at once.",
		voiceover: "Spin them up all at once.",
		startFrame: SCENES_V4.s3StartWS.from + 30,
	},
	{
		key: "s4",
		caption: "They finish on their own.",
		voiceover: "And they finish on their own.",
		startFrame: SCENES_V4.s4AgentsDone.from + 60,
	},
	{
		key: "s5",
		caption: "Review the diffs.",
		voiceover: "Review the diffs.",
		startFrame: SCENES_V4.s5DiffPanel.from + 60,
	},
	{
		key: "s6",
		caption: "Open any file.",
		voiceover: "Open any file the agent touched.",
		startFrame: SCENES_V4.s6FileNav.from + 30,
	},
	{
		key: "s7",
		caption: "Comments come in.",
		voiceover: "Pull request comments come in.",
		startFrame: SCENES_V4.s7PRComment.from + 30,
	},
	{
		key: "s8",
		caption: "Solve them with AI.",
		voiceover: "Solve them with one click.",
		startFrame: SCENES_V4.s8SolveResult.from + 60,
	},
	{
		key: "s9",
		caption: "Pick up a ticket.",
		voiceover: "Pick up a ticket from Linear.",
		startFrame: SCENES_V4.s9Tickets.from + 30,
	},
	{
		key: "s10",
		caption: "Review what others ship.",
		voiceover: "Review what your team ships.",
		startFrame: SCENES_V4.s10PRsList.from + 30,
	},
	{
		key: "outro",
		caption: "",
		voiceover: "SuperiorSwarm. Download for Mac at superiorswarm.com.",
		startFrame: SCENES_V4.outro.from + 30,
	},
];
