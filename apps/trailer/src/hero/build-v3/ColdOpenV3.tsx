import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { AppWindow } from "../build/AppWindow";
import { PaneColumn } from "../build/PaneColumn";
import { TerminalBody, type TerminalLine } from "../build/TerminalBody";
import { C } from "../build/colors";
import { ACTS_V3 } from "./timeline";

// Six prefab terminal scripts (reuse content style from ChaosV2).
// One promotes to fullscreen at calm act; rest spawn during multiply.
const SCRIPT_CALM: TerminalLine[] = [
	{ t: "> claude", from: 0, c: C.textSecondary },
	{ t: "", from: 8 },
	{ t: "Claude Code v0.2.14", from: 18, bold: true },
	{ t: "Workspace: SuperiorSwarm · main", from: 26, c: C.textTertiary },
	{ t: "", from: 36 },
	{ t: "> _", from: 60, c: C.textSecondary, bold: true },
];

const SCRIPT_A: TerminalLine[] = [
	{ t: "> codex run", from: 0, c: C.textSecondary },
	{ t: "Codex CLI v1.4.2", from: 12, bold: true },
	{ t: "+ export const PRESETS = [...]", from: 30, c: C.termGreen },
	{ t: "✓ ok", from: 50, c: C.termGreen, bold: true },
];
const SCRIPT_B: TerminalLine[] = [
	{ t: "> aider --yes", from: 0, c: C.textSecondary },
	{ t: "aider v0.62.1", from: 12, bold: true },
	{ t: "Editing src/skills/retry.ts...", from: 30, c: C.textTertiary },
	{ t: "✓ tests pass (24/24)", from: 50, c: C.termGreen, bold: true },
];
const SCRIPT_C: TerminalLine[] = [
	{ t: "> cursor agent", from: 0, c: C.textSecondary },
	{ t: "Cursor Agent v0.42", from: 12, bold: true },
	{ t: "Refactoring useStore.ts...", from: 30, c: C.textTertiary },
	{ t: "✓ 3 files changed", from: 50, c: C.termGreen, bold: true },
];
const SCRIPT_D: TerminalLine[] = [
	{ t: "> windsurf", from: 0, c: C.textSecondary },
	{ t: "Windsurf v1.2.0", from: 12, bold: true },
	{ t: "Streaming completion...", from: 30, c: C.textTertiary },
	{ t: "✓ done", from: 50, c: C.termGreen, bold: true },
];
const SCRIPT_E: TerminalLine[] = [
	{ t: "> gpt-cli", from: 0, c: C.textSecondary },
	{ t: "GPT CLI v0.9", from: 12, bold: true },
	{ t: "Generating tests...", from: 30, c: C.textTertiary },
	{ t: "✓ 12 tests added", from: 50, c: C.termGreen, bold: true },
];

const SCRIPTS = [SCRIPT_A, SCRIPT_B, SCRIPT_C, SCRIPT_D, SCRIPT_E];

interface Tile {
	col: number;
	row: number;
	cols: number;
	rows: number;
	scriptIdx: number;
	entry: number; // local frame within multiply act
}

// 12 tiles in 4×3 grid.
const TILES: Tile[] = [
	{ col: 0, row: 0, cols: 4, rows: 3, scriptIdx: 0, entry: 0 },
	{ col: 1, row: 0, cols: 4, rows: 3, scriptIdx: 1, entry: 30 },
	{ col: 2, row: 1, cols: 4, rows: 3, scriptIdx: 2, entry: 60 },
	{ col: 3, row: 0, cols: 4, rows: 3, scriptIdx: 3, entry: 90 },
	{ col: 0, row: 2, cols: 4, rows: 3, scriptIdx: 4, entry: 120 },
	{ col: 2, row: 0, cols: 4, rows: 3, scriptIdx: 0, entry: 150 },
	{ col: 1, row: 2, cols: 4, rows: 3, scriptIdx: 1, entry: 170 },
	{ col: 3, row: 2, cols: 4, rows: 3, scriptIdx: 2, entry: 190 },
	{ col: 0, row: 1, cols: 4, rows: 3, scriptIdx: 3, entry: 210 },
	{ col: 3, row: 1, cols: 4, rows: 3, scriptIdx: 4, entry: 230 },
	{ col: 1, row: 1, cols: 4, rows: 3, scriptIdx: 0, entry: 250 },
	{ col: 2, row: 2, cols: 4, rows: 3, scriptIdx: 1, entry: 270 },
];

const FRAME_W = 1920;
const FRAME_H = 1080;
const WINDOW_W = 1620;
const WINDOW_H = 900;

export function ColdOpenV3() {
	const frame = useCurrentFrame();
	const calmStart = ACTS_V3.calm.from;
	const multiplyStart = ACTS_V3.multiply.from; // 180
	const multiplyEnd = multiplyStart + ACTS_V3.multiply.durationInFrames; // 480

	if (frame >= multiplyEnd) return null;

	// Calm act: single hero terminal centered, near full size.
	if (frame < multiplyStart) {
		const enter = interpolate(frame, [calmStart, calmStart + 24], [0, 1], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});
		return (
			<AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: enter }}>
				<AppWindow width={WINDOW_W} height={WINDOW_H} agentCount={0}>
					<PaneColumn
						tabs={[{ id: "calm", kind: "terminal", title: "claude · main" }]}
						activeId="calm"
					>
						<TerminalBody startFrame={calmStart} lines={SCRIPT_CALM} />
					</PaneColumn>
				</AppWindow>
			</AbsoluteFill>
		);
	}

	// Multiply act: 12 tiles populate 4×3 grid.
	const localFrame = frame - multiplyStart;
	const cellW = FRAME_W / 4;
	const cellH = FRAME_H / 3;
	const tileW = WINDOW_W / 2.4; // shrink to fit grid
	const tileH = WINDOW_H / 2.4;
	const tileScale = cellW / WINDOW_W;

	return (
		<AbsoluteFill style={{ background: "#000" }}>
			{TILES.map((t, i) => {
				if (localFrame < t.entry) return null;
				const enter = interpolate(localFrame, [t.entry, t.entry + 12], [0, 1], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				const x = t.col * cellW + cellW / 2 - tileW / 2;
				const y = t.row * cellH + cellH / 2 - tileH / 2;
				const script = i === 0 ? SCRIPT_CALM : SCRIPTS[t.scriptIdx % SCRIPTS.length]!;
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static positions
						key={i}
						style={{
							position: "absolute",
							left: x,
							top: y,
							transform: `scale(${tileScale})`,
							transformOrigin: "0 0",
							opacity: enter,
						}}
					>
						<AppWindow width={WINDOW_W} height={WINDOW_H} agentCount={0}>
							<PaneColumn
								tabs={[{ id: `t${i}`, kind: "terminal", title: `agent ${i + 1}` }]}
								activeId={`t${i}`}
							>
								<TerminalBody startFrame={t.entry} lines={script} />
							</PaneColumn>
						</AppWindow>
					</div>
				);
			})}
		</AbsoluteFill>
	);
}
