import { Composition } from "remotion";
import { HERO_BUILD_V2_FPS, HERO_BUILD_V2_FRAMES, HeroBuildV2 } from "./compositions/HeroBuildV2";

export function Root() {
	return (
		<Composition
			id="HeroBuildV2"
			component={HeroBuildV2}
			durationInFrames={HERO_BUILD_V2_FRAMES}
			fps={HERO_BUILD_V2_FPS}
			width={1920}
			height={1080}
		/>
	);
}
