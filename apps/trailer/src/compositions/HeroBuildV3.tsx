import { AbsoluteFill, Sequence } from "remotion";
import { Bg } from "../hero/Bg";
import { ColdOpenV3 } from "../hero/build-v3/ColdOpenV3";
import { ACTS_V3, TOTAL_FRAMES_V3 } from "../hero/build-v3/timeline";

export const HERO_BUILD_V3_FRAMES = TOTAL_FRAMES_V3;
export const HERO_BUILD_V3_FPS = 60;

export function HeroBuildV3() {
	return (
		<AbsoluteFill>
			<Bg />
			<Sequence
				from={ACTS_V3.calm.from}
				durationInFrames={ACTS_V3.calm.durationInFrames + ACTS_V3.multiply.durationInFrames}
			>
				<ColdOpenV3 />
			</Sequence>
		</AbsoluteFill>
	);
}
