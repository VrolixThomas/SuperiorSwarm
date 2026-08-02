import { describe, expect, test } from "bun:test";
import { mapIssueNode, mapStateNode, mapTeamNode } from "../src/main/linear/linear";

describe("mapTeamNode", () => {
	test("maps a team node to LinearTeam", () => {
		const result = mapTeamNode({ id: "team-1", name: "Engineering", key: "ENG" });
		expect(result).toEqual({ id: "team-1", name: "Engineering", key: "ENG" });
	});
});

describe("mapStateNode", () => {
	test("maps a state node to LinearWorkflowState", () => {
		const result = mapStateNode({
			id: "state-1",
			name: "In Progress",
			color: "#f59e0b",
			type: "started",
			position: 2,
		});
		expect(result).toEqual({
			id: "state-1",
			name: "In Progress",
			color: "#f59e0b",
			type: "started",
			position: 2,
		});
	});
});

describe("mapIssueNode", () => {
	test("maps a full issue node to LinearIssue", () => {
		const node = {
			id: "issue-abc",
			identifier: "ENG-42",
			title: "Fix the login bug",
			url: "https://linear.app/team/issue/ENG-42",
			state: {
				id: "state-1",
				name: "In Progress",
				color: "#f59e0b",
				type: "started" as const,
			},
			team: { id: "team-1", name: "Engineering" },
			assignee: null,
			updatedAt: "2026-08-01T10:00:00.000Z",
			cycle: null,
		};
		const result = mapIssueNode(node);
		expect(result).toEqual({
			id: "issue-abc",
			identifier: "ENG-42",
			title: "Fix the login bug",
			url: "https://linear.app/team/issue/ENG-42",
			stateId: "state-1",
			stateName: "In Progress",
			stateColor: "#f59e0b",
			stateType: "started",
			teamId: "team-1",
			teamName: "Engineering",
			assigneeId: null,
			assigneeName: null,
			assigneeAvatar: null,
			updatedAt: "2026-08-01T10:00:00.000Z",
			cycleId: null,
			cycleName: null,
			planning: { contextId: "team-1", iterationIds: [], bucket: "backlog" },
		});
	});

	test("handles missing optional state fields gracefully", () => {
		const node = {
			id: "issue-xyz",
			identifier: "ENG-99",
			title: "Some issue",
			url: "https://linear.app/team/issue/ENG-99",
			state: { id: "state-2", name: "Todo", color: "#6b7280", type: "unstarted" as const },
			team: { id: "team-1", name: "Engineering" },
			assignee: null,
			updatedAt: "2026-08-01T10:00:00.000Z",
			cycle: null,
		};
		const result = mapIssueNode(node);
		expect(result.identifier).toBe("ENG-99");
		expect(result.stateType).toBe("unstarted");
	});

	test("maps cycle membership into planning metadata", () => {
		const result = mapIssueNode({
			id: "issue-cycle",
			identifier: "ENG-100",
			title: "Planned issue",
			url: "https://linear.app/team/issue/ENG-100",
			state: { id: "state-2", name: "Todo", color: "#6b7280", type: "unstarted" },
			team: { id: "team-1", name: "Engineering" },
			assignee: null,
			updatedAt: "2026-08-01T10:00:00.000Z",
			cycle: {
				id: "cycle-10",
				name: "Cycle 10",
				number: 10,
				startsAt: "2999-01-01T00:00:00.000Z",
				endsAt: "2999-01-14T00:00:00.000Z",
				completedAt: null,
			},
		});

		expect(result.cycleName).toBe("Cycle 10");
		expect(result.planning).toEqual({
			contextId: "team-1",
			iterationIds: ["cycle-10"],
			bucket: "future",
		});
	});
});
