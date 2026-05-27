import type { ReactNode } from "react";
import { TerminalBody } from "../../build/TerminalBody";
import { RepoSidebarV4 } from "../RepoSidebarV4";
import { useColorsV4 } from "../colors-v4";
import { SCENES_V4 } from "../timeline";

export function WithSidebarRepos({ header }: { header?: ReactNode }) {
	const c = useColorsV4();

	return (
		<>
			<RepoSidebarV4 segment="repos" />
			<div style={{ flex: 1, background: c.bgBase, display: "flex", flexDirection: "column" }}>
				{header}
				<div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
					<TerminalBody startFrame={SCENES_V4.s2SidebarBuild.from} />
				</div>
			</div>
		</>
	);
}
