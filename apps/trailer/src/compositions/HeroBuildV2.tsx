import { AbsoluteFill, Sequence } from "remotion";
import { Bg } from "../hero/Bg";
import { AudioTracksV2 } from "../hero/build-v2/AudioTracksV2";
import { CaptionV2 } from "../hero/build-v2/Caption";
import { RevealV2 } from "../hero/build-v2/RevealV2";
import { WorkspaceV2 } from "../hero/build-v2/Workspace";
import { ACTS_V2, TOTAL_FRAMES_V2 } from "../hero/build-v2/timeline";

export const HERO_BUILD_V2_FRAMES = TOTAL_FRAMES_V2;
export const HERO_BUILD_V2_FPS = 60;

export function HeroBuildV2() {
	return (
		<AbsoluteFill>
			<Bg />
			<Sequence from={0} durationInFrames={ACTS_V2.reveal.from}>
				<WorkspaceV2 />
			</Sequence>
			<Sequence from={ACTS_V2.reveal.from} durationInFrames={ACTS_V2.reveal.durationInFrames}>
				<RevealV2 />
			</Sequence>
			<CaptionV2 />
			<AudioTracksV2 />
		</AbsoluteFill>
	);
}
