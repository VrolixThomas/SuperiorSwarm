import type { ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { AppWindowV4 } from "./AppWindowV4";
import { MainPaneHeaderV4 } from "./MainPaneHeaderV4";
import { type TabPillV4, WorkspaceTabBarV4 } from "./WorkspaceTabBarV4";
import { type ViewKeyV4, selectView } from "./WorkspaceViewSelector";
import { type ThemeModeV4, ThemeProviderV4 } from "./colors-v4";
import { SCENES_V4 } from "./timeline";
import { SolveResultFull } from "./views/SolveResultFull";
import { TerminalOnly } from "./views/TerminalOnly";
import { WithActiveWorkspaces } from "./views/WithActiveWorkspaces";
import { WithCommentsPR } from "./views/WithCommentsPR";
import { WithFileNav } from "./views/WithFileNav";
import { WithPRsTab } from "./views/WithPRsTab";
import { WithRightPanelChanges } from "./views/WithRightPanelChanges";
import { WithSidebarRepos } from "./views/WithSidebarRepos";
import { WithTicketsTab } from "./views/WithTicketsTab";

function ViewRenderer({ viewKey, header }: { viewKey: ViewKeyV4; header: ReactNode }) {
	switch (viewKey) {
		case "terminalOnly":
			return <TerminalOnly header={header} />;
		case "withSidebarRepos":
			return <WithSidebarRepos header={header} />;
		case "withActiveWorkspaces":
			return <WithActiveWorkspaces header={header} />;
		case "withRightPanelChanges":
			return <WithRightPanelChanges tabBar={header} />;
		case "withFileNav":
			return <WithFileNav tabBar={header} />;
		case "withCommentsPR":
			return <WithCommentsPR tabBar={header} />;
		case "solveResultFull":
			return <SolveResultFull tabBar={header} />;
		case "withTicketsTab":
			return <WithTicketsTab header={header} />;
		case "withPRsTab":
			return <WithPRsTab header={header} />;
	}
}

// Per-scene tab strip composition. Terminal-only scenes still get a Terminal 1
// tab so the chrome is consistent from the first frame.
function tabsForScene(viewKey: ViewKeyV4): { tabs: TabPillV4[]; activeId: string | null } {
	const terminal: TabPillV4 = { id: "term-1", title: "Terminal 1", kind: "terminal" };
	const review: TabPillV4 = { id: "review", title: "Review", kind: "review" };

	switch (viewKey) {
		case "terminalOnly":
		case "withSidebarRepos":
		case "withActiveWorkspaces":
			return { tabs: [terminal], activeId: terminal.id };
		case "withRightPanelChanges":
		case "withFileNav":
			return { tabs: [terminal, review], activeId: review.id };
		case "withCommentsPR":
		case "solveResultFull":
			return { tabs: [], activeId: null };
		case "withTicketsTab":
		case "withPRsTab":
			return { tabs: [terminal], activeId: terminal.id };
	}
}

interface Props {
	mode?: ThemeModeV4;
}

export function WorkspaceShellV4({ mode = "dark" }: Props) {
	const frame = useCurrentFrame();

	if (frame >= SCENES_V4.outro.from) return null;

	const viewKey = selectView(frame);
	const { tabs, activeId } = tabsForScene(viewKey);

	// Fade the whole pane chrome in over 18f when it first becomes meaningful
	// (workspace pane fully visible at withActiveWorkspaces).
	const chromeOp = interpolate(
		frame,
		[SCENES_V4.s1Terminal.from, SCENES_V4.s1Terminal.from + 18],
		[0, 1],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
	);

	const header =
		tabs.length > 0 ? (
			<MainPaneHeaderV4
				opacity={chromeOp}
				tabBar={<WorkspaceTabBarV4 tabs={tabs} activeTabId={activeId} />}
			/>
		) : null;

	return (
		<ThemeProviderV4 value={mode}>
			<AppWindowV4>
				<ViewRenderer viewKey={viewKey} header={header} />
			</AppWindowV4>
		</ThemeProviderV4>
	);
}
