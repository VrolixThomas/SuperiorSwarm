import { AbsoluteFill, Freeze, Sequence } from "remotion";
import { Bg } from "../hero/Bg";
import { BeforeAfterV3 } from "../hero/build-v3/BeforeAfterV3";
import { CameraV3 } from "../hero/build-v3/Camera";
import { CaptionV3 } from "../hero/build-v3/Caption";
import { ColdOpenV3 } from "../hero/build-v3/ColdOpenV3";
import { CollapseV3 } from "../hero/build-v3/CollapseV3";
import { RevealV3 } from "../hero/build-v3/RevealV3";
import { WorkspaceV3 } from "../hero/build-v3/WorkspaceV3";
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
			<CollapseV3 />
			<CameraV3>
				<WorkspaceV3 />
			</CameraV3>
			{/* Frozen workspace overlay during beforeAfter act */}
			<Sequence
				from={ACTS_V3.beforeAfter.from}
				durationInFrames={ACTS_V3.beforeAfter.durationInFrames}
			>
				<Freeze frame={ACTS_V3.build.from + ACTS_V3.build.durationInFrames - 1}>
					<CameraV3>
						<WorkspaceV3 />
					</CameraV3>
				</Freeze>
			</Sequence>
			<BeforeAfterV3 />
			<Sequence from={ACTS_V3.reveal.from} durationInFrames={ACTS_V3.reveal.durationInFrames}>
				<RevealV3 />
			</Sequence>
			<CaptionV3 />
		</AbsoluteFill>
	);
}
