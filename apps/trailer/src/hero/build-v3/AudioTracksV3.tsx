import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import {
	HERO_V3_MUSIC_PATH,
	HERO_V3_SFX_KEY_PATH,
	HERO_V3_SFX_SLAM_PATH,
	HERO_V3_SFX_WHOOSH_PATH,
} from "./audio";
import { AUDIO_AVAILABLE_V3 } from "./audioManifest.gen";
import { ACTS_V3 } from "./timeline";

// Keystroke triggers during multiplication act (one per tile entry).
const KEY_TRIGGERS = [180, 210, 240, 270, 300, 330, 350, 370, 390, 410, 430, 450];

export function AudioTracksV3() {
	const { durationInFrames, fps } = useVideoConfig();
	const slamFrame = ACTS_V3.collapse.from; // 480
	const whooshStart = slamFrame - 60; // 1s pre-slam riser

	return (
		<>
			{AUDIO_AVAILABLE_V3.music && (
				<Audio
					src={staticFile(HERO_V3_MUSIC_PATH)}
					volume={(frame) =>
						interpolate(
							frame,
							[
								0,
								60,
								slamFrame - 6,
								slamFrame + 30, // duck under slam
								slamFrame + 90,
								durationInFrames - 180,
								durationInFrames,
							],
							[0, 0.18, 0.18, 0, 0.22, 0.22, 0],
							{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
						)
					}
				/>
			)}
			{AUDIO_AVAILABLE_V3.sfxKey &&
				KEY_TRIGGERS.map((f) => (
					<Sequence key={`key-${f}`} from={f} durationInFrames={Math.round(fps * 0.5)}>
						<Audio src={staticFile(HERO_V3_SFX_KEY_PATH)} volume={0.45} />
					</Sequence>
				))}
			{AUDIO_AVAILABLE_V3.sfxWhoosh && (
				<Sequence from={whooshStart} durationInFrames={Math.round(fps * 1.2)}>
					<Audio src={staticFile(HERO_V3_SFX_WHOOSH_PATH)} volume={0.7} />
				</Sequence>
			)}
			{AUDIO_AVAILABLE_V3.sfxSlam && (
				<Sequence from={slamFrame} durationInFrames={Math.round(fps * 0.6)}>
					<Audio src={staticFile(HERO_V3_SFX_SLAM_PATH)} volume={1.0} />
				</Sequence>
			)}
		</>
	);
}
