import { TerminalBody } from "../../build/TerminalBody";
import { useColorsV4 } from "../colors-v4";
import { SCENES_V4 } from "../timeline";

export function TerminalOnly() {
	const c = useColorsV4();
	return (
		<div
			style={{
				flex: 1,
				background: c.bgSurface,
				display: "flex",
				flexDirection: "column",
			}}
		>
			<TerminalBody startFrame={SCENES_V4.s1Terminal.from} />
		</div>
	);
}
