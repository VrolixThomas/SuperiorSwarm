import { useCurrentFrame } from "remotion";
import { AppWindowV4 } from "./AppWindowV4";
import { type ViewKeyV4, selectView } from "./WorkspaceViewSelector";
import { type ThemeModeV4, ThemeProviderV4, useColorsV4 } from "./colors-v4";
import { SolveResultFull } from "./views/SolveResultFull";
import { TerminalOnly } from "./views/TerminalOnly";
import { WithActiveWorkspaces } from "./views/WithActiveWorkspaces";
import { WithCommentsPR } from "./views/WithCommentsPR";
import { WithFileNav } from "./views/WithFileNav";
import { WithRightPanelChanges } from "./views/WithRightPanelChanges";
import { WithSidebarRepos } from "./views/WithSidebarRepos";
import { WithTicketsTab } from "./views/WithTicketsTab";

function ViewStub({ name }: { name: string }) {
	const c = useColorsV4();
	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				color: c.textSecondary,
				fontFamily: "monospace",
				fontSize: 24,
			}}
		>
			{name}
		</div>
	);
}

function ViewRenderer({ viewKey }: { viewKey: ViewKeyV4 }) {
	switch (viewKey) {
		case "terminalOnly":
			return <TerminalOnly />;
		case "withSidebarRepos":
			return <WithSidebarRepos />;
		case "withActiveWorkspaces":
			return <WithActiveWorkspaces />;
		case "withRightPanelChanges":
			return <WithRightPanelChanges />;
		case "withFileNav":
			return <WithFileNav />;
		case "withCommentsPR":
			return <WithCommentsPR />;
		case "solveResultFull":
			return <SolveResultFull />;
		case "withTicketsTab":
			return <WithTicketsTab />;
		default:
			return <ViewStub name={viewKey} />;
	}
}

interface Props {
	mode?: ThemeModeV4;
}

export function WorkspaceShellV4({ mode = "dark" }: Props) {
	const frame = useCurrentFrame();
	const viewKey = selectView(frame);
	return (
		<ThemeProviderV4 value={mode}>
			<AppWindowV4>
				<ViewRenderer viewKey={viewKey} />
			</AppWindowV4>
		</ThemeProviderV4>
	);
}
