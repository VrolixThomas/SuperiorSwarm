import { describe, expect, test } from "bun:test";
import { selectView } from "../src/hero/build-v4/WorkspaceViewSelector";
import { SCENES_V4 } from "../src/hero/build-v4/timeline";

describe("view-selector-v4", () => {
	test("frame 0 returns terminalOnly", () => {
		expect(selectView(0)).toBe("terminalOnly");
	});

	test("opening + s1 both return terminalOnly", () => {
		expect(selectView(SCENES_V4.opening.from)).toBe("terminalOnly");
		expect(selectView(SCENES_V4.s1Terminal.from)).toBe("terminalOnly");
		expect(selectView(SCENES_V4.s2SidebarBuild.from - 1)).toBe("terminalOnly");
	});

	test("s2 + s2b return withSidebarRepos", () => {
		expect(selectView(SCENES_V4.s2SidebarBuild.from)).toBe("withSidebarRepos");
		expect(selectView(SCENES_V4.s2bThemeSweep.from)).toBe("withSidebarRepos");
		expect(selectView(SCENES_V4.s3StartWS.from - 1)).toBe("withSidebarRepos");
	});

	test("s3 + s4 return withActiveWorkspaces", () => {
		expect(selectView(SCENES_V4.s3StartWS.from)).toBe("withActiveWorkspaces");
		expect(selectView(SCENES_V4.s4AgentsDone.from)).toBe("withActiveWorkspaces");
		expect(selectView(SCENES_V4.s5DiffPanel.from - 1)).toBe("withActiveWorkspaces");
	});

	test("s5 returns withRightPanelChanges", () => {
		expect(selectView(SCENES_V4.s5DiffPanel.from)).toBe("withRightPanelChanges");
		expect(selectView(SCENES_V4.s6FileNav.from - 1)).toBe("withRightPanelChanges");
	});

	test("s6 returns withFileNav", () => {
		expect(selectView(SCENES_V4.s6FileNav.from)).toBe("withFileNav");
		expect(selectView(SCENES_V4.s7PRComment.from - 1)).toBe("withFileNav");
	});

	test("s7 returns withCommentsPR", () => {
		expect(selectView(SCENES_V4.s7PRComment.from)).toBe("withCommentsPR");
		expect(selectView(SCENES_V4.s8SolveResult.from - 1)).toBe("withCommentsPR");
	});

	test("s8 returns solveResultFull", () => {
		expect(selectView(SCENES_V4.s8SolveResult.from)).toBe("solveResultFull");
		expect(selectView(SCENES_V4.s9Tickets.from - 1)).toBe("solveResultFull");
	});

	test("s9 returns withTicketsTab", () => {
		expect(selectView(SCENES_V4.s9Tickets.from)).toBe("withTicketsTab");
		expect(selectView(SCENES_V4.s10PRsList.from - 1)).toBe("withTicketsTab");
	});

	test("s10 returns withPRsTab", () => {
		expect(selectView(SCENES_V4.s10PRsList.from)).toBe("withPRsTab");
		expect(selectView(SCENES_V4.s11ReviewResult.from - 1)).toBe("withPRsTab");
	});

	test("s11 + endHold return prReviewResult", () => {
		expect(selectView(SCENES_V4.s11ReviewResult.from)).toBe("prReviewResult");
		expect(selectView(SCENES_V4.endHold.from)).toBe("prReviewResult");
		expect(selectView(SCENES_V4.endHold.from + SCENES_V4.endHold.duration - 1)).toBe(
			"prReviewResult"
		);
	});
});
