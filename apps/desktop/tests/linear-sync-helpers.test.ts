import { describe, expect, test } from "bun:test";
import type { LinearIssue } from "../src/main/linear/linear";
import { extractLinearAssignees } from "../src/main/tickets/sync-helpers";

function makeIssue(overrides: Partial<LinearIssue>): LinearIssue {
	return {
		id: "issue-1",
		identifier: "ENG-1",
		title: "Issue",
		url: "https://linear.app/x/issue/ENG-1",
		stateId: "s1",
		stateName: "Todo",
		stateColor: "#aaa",
		stateType: "unstarted",
		teamId: "team-eng",
		teamName: "Engineering",
		assigneeId: null,
		assigneeName: null,
		assigneeAvatar: null,
		...overrides,
	};
}

describe("extractLinearAssignees", () => {
	test("extracts assignees grouped by teamId", () => {
		const issues: LinearIssue[] = [
			makeIssue({
				id: "i1",
				teamId: "team-a",
				assigneeId: "u1",
				assigneeName: "Alice",
				assigneeAvatar: "a.png",
			}),
			makeIssue({
				id: "i2",
				teamId: "team-a",
				assigneeId: "u2",
				assigneeName: "Bob",
				assigneeAvatar: null,
			}),
			makeIssue({
				id: "i3",
				teamId: "team-b",
				assigneeId: "u1",
				assigneeName: "Alice",
				assigneeAvatar: "a.png",
			}),
		];

		const result = extractLinearAssignees(issues);
		expect(result).toHaveLength(2);

		const a = result.find((r) => r.teamId === "team-a");
		expect(a?.members).toHaveLength(2);
		expect(a?.members.find((m) => m.userId === "u1")?.name).toBe("Alice");

		const b = result.find((r) => r.teamId === "team-b");
		expect(b?.members).toHaveLength(1);
	});

	test("skips issues with no assignee", () => {
		const issues: LinearIssue[] = [
			makeIssue({ id: "i1", teamId: "team-a", assigneeId: null }),
			makeIssue({
				id: "i2",
				teamId: "team-a",
				assigneeId: "u1",
				assigneeName: "Alice",
			}),
		];
		const result = extractLinearAssignees(issues);
		expect(result[0]?.members).toHaveLength(1);
	});

	test("deduplicates the same assignee across multiple issues", () => {
		const issues: LinearIssue[] = [
			makeIssue({
				id: "i1",
				teamId: "team-a",
				assigneeId: "u1",
				assigneeName: "Alice",
			}),
			makeIssue({
				id: "i2",
				teamId: "team-a",
				assigneeId: "u1",
				assigneeName: "Alice",
			}),
		];
		const result = extractLinearAssignees(issues);
		expect(result[0]?.members).toHaveLength(1);
	});

	test("returns empty array for no issues", () => {
		expect(extractLinearAssignees([])).toEqual([]);
	});

	test("preserves avatarUrl when present, null otherwise", () => {
		const issues: LinearIssue[] = [
			makeIssue({
				id: "i1",
				teamId: "team-a",
				assigneeId: "u1",
				assigneeName: "Alice",
				assigneeAvatar: "https://cdn/alice.png",
			}),
			makeIssue({
				id: "i2",
				teamId: "team-a",
				assigneeId: "u2",
				assigneeName: "Bob",
				assigneeAvatar: null,
			}),
		];
		const result = extractLinearAssignees(issues);
		const members = result[0]?.members;
		expect(members?.find((m) => m.userId === "u1")?.avatarUrl).toBe("https://cdn/alice.png");
		expect(members?.find((m) => m.userId === "u2")?.avatarUrl).toBeNull();
	});

	test("skips issues where assigneeId is present but assigneeName is null", () => {
		const issues: LinearIssue[] = [
			makeIssue({ id: "i1", teamId: "team-a", assigneeId: "u1", assigneeName: null }),
		];
		expect(extractLinearAssignees(issues)).toEqual([]);
	});
});
