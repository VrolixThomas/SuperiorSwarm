import { ACTS_V3, BEATS_V3, BEAT_KEYS_V3, beatStartAbsV3 } from "./timeline";

export type CopyKeyV3 =
	| "open"
	| "tickets"
	| "workspace"
	| "worktrees"
	| "splitPane"
	| "prReview"
	| "solve"
	| "beforeAfter";

export interface BeatCopyV3 {
	key: CopyKeyV3;
	caption: string;
	startFrame: number;
}

// Captions used only — no VO. Empty string = caption hidden during that span.
export const BEAT_COPY_V3: BeatCopyV3[] = [
	{ key: "open", caption: "One window.", startFrame: ACTS_V3.collapse.from + 60 },
	...BEAT_KEYS_V3.map<BeatCopyV3>((k) => ({
		key: k,
		caption: BEATS_V3[k].caption,
		startFrame: beatStartAbsV3(k),
	})),
	{ key: "beforeAfter", caption: "From this. To this.", startFrame: ACTS_V3.beforeAfter.from + 60 },
];
