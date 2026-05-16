import { AbsoluteFill } from "remotion";
import { Bg } from "../hero/Bg";
import { AudioBedShort } from "../hero/short-v1/AudioBedShort";
import { WorkspaceShellShort } from "../hero/short-v1/WorkspaceShellShort";
import { OpeningTerminalsShort } from "../hero/short-v1/scenes/OpeningTerminalsShort";
import { OutroShort } from "../hero/short-v1/scenes/OutroShort";
import { TOTAL_FRAMES_SHORT } from "../hero/short-v1/timeline";

export const HERO_BUILD_SHORT_V1_FRAMES = TOTAL_FRAMES_SHORT;
export const HERO_BUILD_SHORT_V1_FPS = 60;

export function HeroBuildShortV1() {
	return (
		<AbsoluteFill>
			<Bg />
			<WorkspaceShellShort />
			<OpeningTerminalsShort />
			<OutroShort />
			<AudioBedShort />
		</AbsoluteFill>
	);
}
