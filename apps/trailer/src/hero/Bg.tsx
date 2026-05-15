import { AbsoluteFill } from "remotion";
import { HERO } from "./theme";

export function Bg() {
	return (
		<>
			<AbsoluteFill style={{ background: HERO.bg }} />
			<AbsoluteFill style={{ background: HERO.glow }} />
		</>
	);
}
