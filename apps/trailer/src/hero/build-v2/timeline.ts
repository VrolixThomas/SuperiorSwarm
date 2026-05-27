// V2 timeline. 60fps. Silent v1 — VO drops in later.
// Total: 3960f = 66s.
//
// Acts:
//   Chaos    0–300    5s    six tilted drifting terminals
//   Collapse 300–480  3s    five fade, one survives → center
//   Build    480–3480 50s   12 beats × 250f
//   Reveal   3480–3960 8s   pull back, wordmark
export const FPS_V2 = 60;

export const ACTS_V2 = {
	chaos: { from: 0, durationInFrames: 300 },
	collapse: { from: 300, durationInFrames: 180 },
	build: { from: 480, durationInFrames: 3100 },
	reveal: { from: 3580, durationInFrames: 480 },
} as const;

export const TOTAL_FRAMES_V2 = 4060;

// Offsets from ACTS_V2.build.from (= 480 absolute).
// Each beat owns one caption + one component arrival.
// Captions are placeholder — voice-over will replace.
export const BEATS_V2 = {
	tabs: { offset: 0, durationInFrames: 250, caption: "Run every agent in one terminal." },
	sidebar: { offset: 250, durationInFrames: 250, caption: "The workspace remembers your repos." },
	reposCascade: { offset: 500, durationInFrames: 250, caption: "All of them." },
	worktrees: {
		offset: 750,
		durationInFrames: 250,
		caption: "One branch per worktree. In parallel.",
	},
	agentBadges: { offset: 1000, durationInFrames: 250, caption: "Every agent. Every branch. Live." },
	rightDiff: {
		offset: 1250,
		durationInFrames: 250,
		caption: "Files. Diffs. Comments. Beside the work.",
	},
	splitPane: {
		offset: 1500,
		durationInFrames: 250,
		caption: "Open the file beside the agent writing it.",
	},
	rightChanges: {
		offset: 1750,
		durationInFrames: 250,
		caption: "Commits, working changes, branches. All here.",
	},
	review: {
		offset: 2000,
		durationInFrames: 250,
		caption: "Review pull requests without leaving.",
	},
	commentsSolve: {
		offset: 2250,
		durationInFrames: 350,
		caption: "Resolve every comment. One click.",
	},
	tickets: {
		offset: 2600,
		durationInFrames: 250,
		caption: "Linear. Jira. GitHub Issues. One place.",
	},
	prs: {
		offset: 2850,
		durationInFrames: 250,
		caption: "Every PR. Every review. Beside the work.",
	},
} as const;

export type BeatKeyV2 = keyof typeof BEATS_V2;

export function beatStartAbsV2(key: BeatKeyV2): number {
	return ACTS_V2.build.from + BEATS_V2[key].offset;
}

// Convention: caption swaps at beat start, component springs in 24f later, rest after 60f.
export function beatEntryFrameV2(key: BeatKeyV2, delay = 24): number {
	return beatStartAbsV2(key) + delay;
}

export const BEAT_KEYS_V2: BeatKeyV2[] = [
	"tabs",
	"sidebar",
	"reposCascade",
	"worktrees",
	"agentBadges",
	"rightDiff",
	"splitPane",
	"rightChanges",
	"review",
	"commentsSolve",
	"tickets",
	"prs",
];

// Universal spring per V2 director rules.
export const SPRING_V2 = { damping: 22, stiffness: 110, mass: 0.7 } as const;

// V2 palette — single accent + single success.
export const PALETTE_V2 = {
	accent: "#c4956c",
	accentSoft: "rgba(196,149,108,0.35)",
	success: "#9be39c",
	successSoft: "rgba(155,227,156,0.30)",
} as const;

// Three named agents recur across the video. Color them consistently.
export const AGENTS_V2 = [
	{ id: "claude", label: "claude", color: "#c4956c" },
	{ id: "codex", label: "codex", color: "#74c0fc" },
	{ id: "aider", label: "aider", color: "#9be39c" },
] as const;
