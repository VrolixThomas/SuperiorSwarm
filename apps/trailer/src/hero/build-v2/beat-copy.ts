import { BEAT_KEYS_V2, type BeatKeyV2, beatStartAbsV2 } from "./timeline";

export type CopyKey = BeatKeyV2 | "intro" | "collapse" | "reveal";

export interface BeatCopy {
	key: CopyKey;
	caption: string;
	voiceover: string;
	startFrame: number;
}

const NON_BEAT: {
	key: Exclude<CopyKey, BeatKeyV2>;
	caption: string;
	voiceover: string;
	startFrame: number;
}[] = [
	{
		key: "intro",
		caption: "Every AI tool gave you another window.",
		voiceover: "Every AI tool gave you another window.",
		startFrame: 60,
	},
	{
		key: "collapse",
		caption: "We started with one.",
		voiceover: "We started with one.",
		startFrame: 310,
	},
	{
		key: "reveal",
		caption: "",
		voiceover: "SuperiorSwarm. Download for macOS at superiorswarm.com.",
		startFrame: 3580,
	},
];

const BEAT_VO: Record<BeatKeyV2, { caption: string; voiceover: string }> = {
	tabs: {
		caption: "Run every agent in one terminal.",
		voiceover: "Run every agent in one terminal.",
	},
	sidebar: {
		caption: "The workspace remembers your repos.",
		voiceover: "The workspace remembers your repos.",
	},
	reposCascade: {
		caption: "All of them. Side by side.",
		voiceover: "All of them. Side by side.",
	},
	worktrees: {
		caption: "One worktree per branch. In parallel.",
		voiceover: "One worktree per branch. In parallel.",
	},
	agentBadges: {
		caption: "Live status, beside every agent.",
		voiceover: "Live status, beside every agent.",
	},
	rightDiff: {
		caption: "Files. Diffs. Comments. Beside the work.",
		voiceover: "Files. Diffs. Comments. Beside the work.",
	},
	splitPane: {
		caption: "Open the file the agent is writing.",
		voiceover: "Open the file the agent is writing.",
	},
	rightChanges: {
		caption: "Changes, commits, branches — one panel.",
		voiceover: "Changes, commits, branches — one panel.",
	},
	review: {
		caption: "Review pull requests without leaving the editor.",
		voiceover: "Review pull requests without leaving the editor.",
	},
	commentsSolve: {
		caption: "Resolve every comment. With one command.",
		voiceover: "Resolve every comment. With one command.",
	},
	tickets: {
		caption: "Linear, Jira, GitHub — one inbox.",
		voiceover: "Linear, Jira, GitHub — one inbox.",
	},
	prs: {
		caption: "Every pull request, in flow.",
		voiceover: "Every pull request, in flow.",
	},
};

export const BEAT_COPY: BeatCopy[] = [
	...NON_BEAT.filter((e) => e.key === "intro" || e.key === "collapse"),
	...BEAT_KEYS_V2.map<BeatCopy>((k) => ({
		key: k,
		caption: BEAT_VO[k].caption,
		voiceover: BEAT_VO[k].voiceover,
		startFrame: beatStartAbsV2(k),
	})),
	...NON_BEAT.filter((e) => e.key === "reveal"),
];

export const COPY_KEYS: CopyKey[] = BEAT_COPY.map((b) => b.key);
