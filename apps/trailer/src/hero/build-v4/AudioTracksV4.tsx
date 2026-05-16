import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { finishOrder } from "./agentOrder";
import {
	HERO_V4_MUSIC_PATH,
	HERO_V4_SFX_CHIME_PATH,
	HERO_V4_SFX_DING_PATH,
	HERO_V4_SFX_POP_PATH,
	HERO_V4_SFX_WHOOSH_PATH,
} from "./audio";
import { AUDIO_AVAILABLE_V4 } from "./audioManifest.gen";
import { SCENES_V4 } from "./timeline";

// Tile pop triggers: 8 tiles × 30 stagger + 18 entry offset.
const POP_TRIGGERS = Array.from({ length: 8 }, (_, i) => i * 30 + 18);

// Ding triggers for s4 random green flips.
const N_AGENTS = 6;
const FINISH_BASE = SCENES_V4.s4AgentsDone.from;
const FINISH_SPACING = 60;
const DING_TRIGGERS = finishOrder(N_AGENTS).map((_, slot) => FINISH_BASE + slot * FINISH_SPACING);

const WHOOSH_TRIGGERS = [SCENES_V4.s2bThemeSweep.from, SCENES_V4.s2bThemeSweep.from + 120];
const CHIME_TRIGGERS = [SCENES_V4.s8SolveResult.from + 30];
// Click cue removed — the AIResolveCursor visual that motivated it is gone.

export function AudioTracksV4() {
	const { durationInFrames, fps } = useVideoConfig();

	return (
		<>
			{AUDIO_AVAILABLE_V4.music && (
				<Audio
					src={staticFile(HERO_V4_MUSIC_PATH)}
					volume={(frame) =>
						interpolate(
							frame,
							[0, 60, durationInFrames - 60, durationInFrames],
							[0, 0.22, 0.22, 0],
							{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
						)
					}
				/>
			)}
			{AUDIO_AVAILABLE_V4.sfxPop &&
				POP_TRIGGERS.map((f) => (
					<Sequence key={`pop-${f}`} from={f} durationInFrames={Math.round(fps * 0.4)}>
						<Audio src={staticFile(HERO_V4_SFX_POP_PATH)} volume={0.55} />
					</Sequence>
				))}
			{AUDIO_AVAILABLE_V4.sfxWhoosh &&
				WHOOSH_TRIGGERS.map((f) => (
					<Sequence key={`whoosh-${f}`} from={f} durationInFrames={Math.round(fps * 1.2)}>
						<Audio src={staticFile(HERO_V4_SFX_WHOOSH_PATH)} volume={0.6} />
					</Sequence>
				))}
			{AUDIO_AVAILABLE_V4.sfxDing &&
				DING_TRIGGERS.map((f) => (
					<Sequence key={`ding-${f}`} from={f} durationInFrames={Math.round(fps * 0.6)}>
						<Audio src={staticFile(HERO_V4_SFX_DING_PATH)} volume={0.5} />
					</Sequence>
				))}
			{AUDIO_AVAILABLE_V4.sfxChime &&
				CHIME_TRIGGERS.map((f) => (
					<Sequence key={`chime-${f}`} from={f} durationInFrames={Math.round(fps * 1.4)}>
						<Audio src={staticFile(HERO_V4_SFX_CHIME_PATH)} volume={0.7} />
					</Sequence>
				))}
		</>
	);
}
