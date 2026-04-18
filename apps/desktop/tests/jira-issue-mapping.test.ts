import { describe, expect, test } from "bun:test";
import type { JiraIssue } from "../src/main/atlassian/jira";

describe("JiraIssue assignee fields", () => {
	test("JiraIssue type includes assignee fields", () => {
		const issue: JiraIssue = {
			key: "PROJ-1",
			summary: "Test",
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
