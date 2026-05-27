import type { ReactNode } from "react";
import { TerminalBody } from "../../build/TerminalBody";
import { useColorsV4 } from "../colors-v4";
import { SCENES_V4 } from "../timeline";

export function TerminalOnly({ header }: { header?: ReactNode }) {
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
			{header}
			<div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
				<TerminalBody startFrame={SCENES_V4.s1Terminal.from} />
			</div>
		</div>
	);
}
