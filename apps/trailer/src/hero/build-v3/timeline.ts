// V3 timeline. 60fps. 60s total = 3600f.
// Acts:
//   calm         0–180     3s    one terminal, prompt blinking
//   multiply     180–480   5s    1→2→4→12 terminals
//   collapse     480–600   2s    slam, silence, one window fades up
//   build        600–2400  30s   six beats × 300f
//   beforeAfter  2400–2880 8s    11 ghost windows fade in then out
//   reveal       2880–3600 12s   wordmark + URL + hold
export const FPS_V3 = 60;

export const ACTS_V3 = {
	calm: { from: 0, durationInFrames: 180 },
	multiply: { from: 180, durationInFrames: 300 },
	collapse: { from: 480, durationInFrames: 120 },
	build: { from: 600, durationInFrames: 1800 },
	beforeAfter: { from: 2400, durationInFrames: 480 },
	reveal: { from: 2880, durationInFrames: 720 },
} as const;

export const TOTAL_FRAMES_V3 = 3600;

// Each beat 300f (= 5s). Offsets from ACTS_V3.build.from.
export const BEATS_V3 = {
	tickets: { offset: 0, durationInFrames: 300, caption: "Linear. Jira. GitHub. One inbox." },
	workspace: { offset: 300, durationInFrames: 300, caption: "Every agent. One terminal." },
	worktrees: { offset: 600, durationInFrames: 300, caption: "One worktree per branch." },
	splitPane: { offset: 900, durationInFrames: 300, caption: "Open the file the agent is writing." },
	prReview: { offset: 1200, durationInFrames: 300, caption: "Review without leaving." },
	solve: { offset: 1500, durationInFrames: 300, caption: "Resolve every comment. One command." },
} as const;

export type BeatKeyV3 = keyof typeof BEATS_V3;

export const BEAT_KEYS_V3: BeatKeyV3[] = [
	"tickets",
	"workspace",
	"worktrees",
	"splitPane",
	"prReview",
	"solve",
];

export function beatStartAbsV3(key: BeatKeyV3): number {
	return ACTS_V3.build.from + BEATS_V3[key].offset;
}

export function beatEntryFrameV3(key: BeatKeyV3, delay = 18): number {
	return beatStartAbsV3(key) + delay;
}

export const SPRING_V3 = { damping: 22, stiffness: 110, mass: 0.7 } as const;

// Palette: warm sepia base + cool-blue contrast accent (tickets beat).
export const PALETTE_V3 = {
	warm: "#c4956c",
	warmSoft: "rgba(196,149,108,0.35)",
	cool: "#74c0fc",
	coolSoft: "rgba(116,192,252,0.35)",
	success: "#9be39c",
	bg: "#0a0a0c",
} as const;
