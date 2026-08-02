import { describe, expect, test } from "bun:test";
import { type JiraIssue, mapApiIssue, mergeJiraPlanningIssues } from "../src/main/atlassian/jira";

function jiraIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
	return {
		key: "PROJ-1",
		summary: "Test",
		statusId: "3",
		status: "In Progress",
		statusCategory: "indeterminate",
		statusColor: "#0052CC",
		priority: "Medium",
		issueType: "Task",
		projectKey: "PROJ",
		webUrl: "https://jira.example.com/browse/PROJ-1",
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-02T00:00:00Z",
		assigneeId: null,
		assigneeName: null,
		assigneeAvatar: null,
		...overrides,
	};
}

describe("JiraIssue assignee fields", () => {
	test("JiraIssue type includes assignee fields", () => {
		const issue: JiraIssue = {
			key: "PROJ-1",
			summary: "Test",
			statusId: "3",
			status: "In Progress",
			statusCategory: "indeterminate",
			statusColor: "#0052CC",
			priority: "Medium",
			issueType: "Task",
			projectKey: "PROJ",
			webUrl: "https://jira.example.com/browse/PROJ-1",
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-02T00:00:00Z",
			assigneeId: "acc-123",
			assigneeName: "John Smith",
			assigneeAvatar: "https://avatar.url/24x24",
		};
		expect(issue.assigneeId).toBe("acc-123");
		expect(issue.assigneeName).toBe("John Smith");
	});

	test("JiraIssue allows null assignee", () => {
		const issue: JiraIssue = {
			key: "PROJ-2",
			summary: "Unassigned",
			statusId: "1",
			status: "To Do",
			statusCategory: "new",
			statusColor: "#42526E",
			priority: "Low",
			issueType: "Bug",
			projectKey: "PROJ",
			webUrl: "https://jira.example.com/browse/PROJ-2",
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-02T00:00:00Z",
			assigneeId: null,
			assigneeName: null,
			assigneeAvatar: null,
		};
		expect(issue.assigneeId).toBeNull();
	});
});

describe("mapApiIssue", () => {
	test("keeps Jira's exact status ID for configured board columns", () => {
		const mapped = mapApiIssue(
			{
				key: "PROJ-7",
				fields: {
					summary: "Review this",
					status: {
						id: "10042",
						name: "Ready for review",
						statusCategory: { key: "indeterminate" },
					},
					priority: { name: "High" },
					issuetype: { name: "Task" },
					project: { key: "PROJ" },
					created: "2026-01-01T00:00:00Z",
					updated: "2026-01-02T00:00:00Z",
					assignee: null,
				},
			},
			"https://example.atlassian.net"
		);

		expect(mapped.statusId).toBe("10042");
		expect(mapped.status).toBe("Ready for review");
	});
});

describe("mergeJiraPlanningIssues", () => {
	test("deduplicates issues, unions sprint membership, and prefers the current sprint", () => {
		const merged = mergeJiraPlanningIssues([
			[
				jiraIssue({
					planning: { contextId: "board-1", iterationIds: [], bucket: "backlog" },
				}),
			],
			[
				jiraIssue({
					planning: {
						contextId: "board-1",
						iterationIds: ["sprint-1"],
						bucket: "active",
					},
				}),
			],
		]);

		expect(merged).toHaveLength(1);
		expect(merged[0]?.planning).toEqual({
			contextId: "board-1",
			iterationIds: ["sprint-1"],
			bucket: "active",
		});
	});

	test("keeps the stable project snapshot while enriching board issues", () => {
		const merged = mergeJiraPlanningIssues([
			[jiraIssue({ key: "PROJ-1" }), jiraIssue({ key: "PROJ-2" })],
			[
				jiraIssue({
					key: "PROJ-1",
					planning: { contextId: "board-1", iterationIds: [], bucket: "backlog" },
				}),
			],
		]);

		expect(merged.map((issue) => issue.key).sort()).toEqual(["PROJ-1", "PROJ-2"]);
		expect(merged.find((issue) => issue.key === "PROJ-1")?.planning?.contextId).toBe("board-1");
		expect(merged.find((issue) => issue.key === "PROJ-2")?.planning).toBeUndefined();
	});
});
