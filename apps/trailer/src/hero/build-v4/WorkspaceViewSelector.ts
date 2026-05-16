import { SCENES_V4 } from "./timeline";

export type ViewKeyV4 =
	| "terminalOnly"
	| "withSidebarRepos"
	| "withActiveWorkspaces"
	| "withRightPanelChanges"
	| "withFileNav"
	| "withCommentsPR"
	| "solveResultFull"
	| "withTicketsTab"
	| "withPRsTab"
	| "prReviewResult";

export function selectView(frame: number): ViewKeyV4 {
	const s = SCENES_V4;
	if (frame < s.s2SidebarBuild.from) return "terminalOnly";
	if (frame < s.s3StartWS.from) return "withSidebarRepos";
	if (frame < s.s5DiffPanel.from) return "withActiveWorkspaces";
	if (frame < s.s6FileNav.from) return "withRightPanelChanges";
	if (frame < s.s7PRComment.from) return "withFileNav";
	if (frame < s.s8SolveResult.from) return "withCommentsPR";
	if (frame < s.s9Tickets.from) return "solveResultFull";
	if (frame < s.s10PRsList.from) return "withTicketsTab";
	if (frame < s.s11ReviewResult.from) return "withPRsTab";
	return "prReviewResult";
}
