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
import { BEAT_COPY_V4 } from "./beat-copy";
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

// Rough VO duration estimate (frames) from text length. 13 chars/sec at 60fps.
function estimateVOFrames(text: string, fps: number): number {
	const seconds = Math.max(1.0, text.length / 13);
	return Math.round(seconds * fps);
}

// Music volume curve with ducking during VO windows. Each window lowers the
// base 0.18 to 0.05 with 12f fades on each edge.
function buildMusicVolume(totalFrames: number, fps: number): (frame: number) => number {
	const base = 0.18;
	const ducked = 0.05;
	const fade = 12;
	const windows = BEAT_COPY_V4.filter(
		(b) => b.voiceover && AUDIO_AVAILABLE_V4.voiceover[b.key]
	).map((b) => ({
		start: b.startFrame,
		end: b.startFrame + estimateVOFrames(b.voiceover, fps),
	}));
	return (frame) => {
		// Intro/outro fade.
		const envelope = interpolate(frame, [0, 60, totalFrames - 60, totalFrames], [0, 1, 1, 0], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});
		// Find active duck.
		let target = base;
		for (const w of windows) {
			if (frame >= w.start - fade && frame <= w.end + fade) {
				const inAmt = interpolate(frame, [w.start - fade, w.start], [0, 1], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				const outAmt = interpolate(frame, [w.end, w.end + fade], [1, 0], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				const t = Math.min(inAmt, outAmt);
				target = Math.min(target, base + (ducked - base) * t);
			}
		}
		return target * envelope;
	};
}

export function AudioTracksV4() {
	const { durationInFrames, fps } = useVideoConfig();
	const musicVolume = buildMusicVolume(durationInFrames, fps);

	return (
		<>
			{AUDIO_AVAILABLE_V4.music && (
				<Audio src={staticFile(HERO_V4_MUSIC_PATH)} volume={musicVolume} />
			)}
			{BEAT_COPY_V4.map((beat) => {
				if (!beat.voiceover) return null;
				if (!AUDIO_AVAILABLE_V4.voiceover[beat.key]) return null;
				const durFrames = estimateVOFrames(beat.voiceover, fps) + fps;
				return (
					<Sequence key={`vo-${beat.key}`} from={beat.startFrame} durationInFrames={durFrames}>
						<Audio src={staticFile(`audio/v4/vo-${beat.key}.mp3`)} volume={0.95} />
					</Sequence>
				);
			})}
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
