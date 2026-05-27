// Music-only audio for short-v1. Prefers public/audio/short-v1/music.mp3 if a
// dedicated bed has been generated; otherwise falls back to the most energetic
// 30s slice of v4's music with fast in/out fades.

import { Audio, interpolate, staticFile, useVideoConfig } from "remotion";
import { AUDIO_AVAILABLE_SHORT } from "./audioManifest.gen";

const SHORT_MUSIC_PATH = "audio/short-v1/music.mp3";
const V4_MUSIC_PATH = "audio/v4/music.mp3";

// When falling back to v4 music, start ~20s in (past the slow intro) and play
// for the full 30s of the short.
const V4_FALLBACK_START_SECS = 20;

export function AudioBedShort() {
	const { durationInFrames, fps } = useVideoConfig();

	const envelope = (frame: number) =>
		interpolate(frame, [0, 24, durationInFrames - 24, durationInFrames], [0, 1, 1, 0], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});
	const volume = (frame: number) => 0.22 * envelope(frame);

	if (AUDIO_AVAILABLE_SHORT.music) {
		return <Audio src={staticFile(SHORT_MUSIC_PATH)} volume={volume} />;
	}
	if (AUDIO_AVAILABLE_SHORT.musicFallbackV4) {
		return (
			<Audio
				src={staticFile(V4_MUSIC_PATH)}
				volume={volume}
				startFrom={V4_FALLBACK_START_SECS * fps}
			/>
		);
	}
	return null;
}
