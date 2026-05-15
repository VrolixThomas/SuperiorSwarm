import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { HERO_V2_MUSIC_PATH, heroV2VoicePath } from "./audio";
import { AUDIO_AVAILABLE_V2 } from "./audioManifest.gen";
import { BEAT_COPY } from "./beat-copy";

export function AudioTracksV2() {
	const { durationInFrames } = useVideoConfig();

	return (
		<>
			{AUDIO_AVAILABLE_V2.music && (
				<Audio
					src={staticFile(HERO_V2_MUSIC_PATH)}
					volume={(frame) =>
						interpolate(
							frame,
							[0, 90, durationInFrames - 150, durationInFrames],
							[0, 0.16, 0.16, 0],
							{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
						)
					}
				/>
			)}
			{BEAT_COPY.map((b) =>
				AUDIO_AVAILABLE_V2.voiceover[b.key] && b.voiceover ? (
					<Sequence key={b.key} from={b.startFrame}>
						<Audio src={staticFile(heroV2VoicePath(b.key))} volume={1} />
					</Sequence>
				) : null
			)}
		</>
	);
}
