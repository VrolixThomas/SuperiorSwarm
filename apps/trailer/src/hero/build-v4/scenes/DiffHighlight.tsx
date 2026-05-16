import { interpolate, useCurrentFrame } from "remotion";
import { useColorsV4 } from "../colors-v4";
import { DEMO_FILES_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

// Approximate code editor geometry: editor starts at x=SIDEBAR_WIDTH (280), y=52 (title bar),
// each line is ~22px tall, columns start at x=340 (margin + gutter ~60px).
const SIDEBAR_WIDTH = 280;
const EDITOR_TOP = 52 + 40; // title bar + tab strip
const LINE_HEIGHT = 22;
const GUTTER = 60;
const EDITOR_RIGHT_GAP = 380 + 16; // right panel + gap

export function DiffHighlight() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s5DiffPanel.from;

	// Each hunk highlights for 180f, sequenced through DEMO_FILES_V4[0].hunks.
	const file = DEMO_FILES_V4[0];
	if (!file) return null;
	const hunks = file.hunks;
	const HUNK_DUR = 180;
	const idx = Math.floor(local / HUNK_DUR);
	const hunk = hunks[idx];
	if (!hunk) return null;

	const localInHunk = local - idx * HUNK_DUR;
	const op = interpolate(localInHunk, [0, 20, HUNK_DUR - 30, HUNK_DUR], [0, 1, 1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const y = EDITOR_TOP + hunk.startLine * LINE_HEIGHT;
	const lineCount = hunk.additions.length;
	const height = lineCount * LINE_HEIGHT + 4;

	return (
		<div
			style={{
				position: "absolute",
				left: SIDEBAR_WIDTH + GUTTER,
				right: EDITOR_RIGHT_GAP,
				top: y,
				height,
				border: `1px solid ${c.accent}`,
				borderRadius: 4,
				boxShadow: `0 0 12px ${c.accent}`,
				opacity: op,
				pointerEvents: "none",
			}}
		/>
	);
}
