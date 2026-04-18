import { describe, expect, test } from "bun:test";
import { mapIssueNode } from "../src/main/linear/linear";

describe("mapIssueNode", () => {
	test("maps assignee fields when present", () => {
		const node = {
			id: "issue-1",
			identifier: "FE-123",
			title: "Test issue",
			url: "https://linear.app/issue/FE-123",
			state: { id: "s1", name: "In Progress", color: "#0052CC", type: "started" as const },
			team: { id: "t1", name: "Frontend" },
			assignee: { id: "u1", name: "Jane Doe", avatarUrl: "https://avatar.url" },
		};
		const result = mapIssueNode(node);
		expect(result.assigneeId).toBe("u1");
		expect(result.assigneeName).toBe("Jane Doe");
		expect(result.assigneeAvatar).toBe("https://avatar.url");
	});

	test("maps null assignee when unassigned", () => {
		const node = {
			id: "issue-2",
			identifier: "FE-124",
			title: "Unassigned issue",
			url: "https://linear.app/issue/FE-124",
			state: { id: "s1", name: "Backlog", color: "#6e6e73", type: "backlog" as const },
			team: { id: "t1", name: "Frontend" },
			assignee: null,
		};
		const result = mapIssueNode(node);
		expect(result.assigneeId).toBeNull();
		expect(result.assigneeName).toBeNull();
		expect(result.assigneeAvatar).toBeNull();
	});
});
