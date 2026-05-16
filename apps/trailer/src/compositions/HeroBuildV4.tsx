import { AbsoluteFill } from "remotion";
import { Bg } from "../hero/Bg";
import { AudioTracksV4 } from "../hero/build-v4/AudioTracksV4";
import { CaptionV4 } from "../hero/build-v4/Caption";
import { WorkspaceShellV4 } from "../hero/build-v4/WorkspaceShellV4";
import { AIResolveCursor } from "../hero/build-v4/scenes/AIResolveCursor";
import { DiffHighlight } from "../hero/build-v4/scenes/DiffHighlight";
import { Opening8Terminals } from "../hero/build-v4/scenes/Opening8Terminals";
import { ThemeSweep } from "../hero/build-v4/scenes/ThemeSweep";
import { TOTAL_FRAMES_V4 } from "../hero/build-v4/timeline";

export const HERO_BUILD_V4_FRAMES = TOTAL_FRAMES_V4;
export const HERO_BUILD_V4_FPS = 60;

export function HeroBuildV4() {
	return (
		<AbsoluteFill>
			<Bg />
			<WorkspaceShellV4 />
			<Opening8Terminals />
			<ThemeSweep />
			<DiffHighlight />
			<AIResolveCursor />
			<CaptionV4 />
			<AudioTracksV4 />
		</AbsoluteFill>
	);
}
