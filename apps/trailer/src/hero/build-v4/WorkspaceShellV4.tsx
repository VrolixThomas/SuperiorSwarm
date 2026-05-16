import { interpolate, useCurrentFrame } from "remotion";
import { AppWindowV4 } from "./AppWindowV4";
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
		case "withPRsTab":
			return <WithPRsTab />;
	}
}

// Per-scene tab strip composition. Tab strip appears from s5 onward; earlier
// scenes (terminal-only / sidebar build / starting workspaces) keep the
// chrome empty so the build-up reads cleanly.
function tabsForScene(viewKey: ViewKeyV4): { tabs: TabPillV4[]; activeId: string | null } {
	const terminal: TabPillV4 = { id: "term-1", title: "Terminal 1", kind: "terminal" };
	const review: TabPillV4 = { id: "review", title: "Review", kind: "review" };
	const solve: TabPillV4 = { id: "solve", title: "Solve Review", kind: "solve" };

	switch (viewKey) {
		case "withRightPanelChanges":
		case "withFileNav":
			return { tabs: [terminal, review], activeId: review.id };
		case "withCommentsPR":
		case "solveResultFull":
			return { tabs: [terminal, review, solve], activeId: solve.id };
		default:
			return { tabs: [], activeId: null };
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

	// Fade the tab strip in over 18f when it first appears at s5DiffPanel.from.
	const tabsOp = interpolate(
		frame,
		[SCENES_V4.s5DiffPanel.from, SCENES_V4.s5DiffPanel.from + 18],
		[0, 1],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" }
	);

	const tabBar =
		tabs.length > 0 ? (
			<WorkspaceTabBarV4 tabs={tabs} activeTabId={activeId} opacity={tabsOp} />
		) : null;

	return (
		<ThemeProviderV4 value={mode}>
			<AppWindowV4 tabBar={tabBar}>
				<ViewRenderer viewKey={viewKey} />
			</AppWindowV4>
		</ThemeProviderV4>
	);
}
