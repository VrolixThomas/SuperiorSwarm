import { describe, expect, test } from "bun:test";
import type { JiraIssue } from "../src/main/atlassian/jira";
import { extractJiraAssignees } from "../src/main/tickets/sync-helpers";

function makeIssue(overrides: Partial<JiraIssue>): JiraIssue {
	return {
		key: "PROJ-1",
		summary: "Issue",
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

describe("extractJiraAssignees", () => {
	test("extracts assignees grouped by projectKey", () => {
		const issues: JiraIssue[] = [
			makeIssue({
				key: "PROJ-1",
				projectKey: "PROJ",
				assigneeId: "acc-1",
				assigneeName: "Alice",
				assigneeAvatar: "https://a.com/alice.png",
			}),
			makeIssue({
				key: "PROJ-2",
				projectKey: "PROJ",
				assigneeId: "acc-2",
				assigneeName: "Bob",
				assigneeAvatar: null,
			}),
			makeIssue({
				key: "OTHER-1",
				projectKey: "OTHER",
				assigneeId: "acc-1",
				assigneeName: "Alice",
				assigneeAvatar: "https://a.com/alice.png",
			}),
		];

		const result = extractJiraAssignees(issues);

		expect(result).toHaveLength(2);

		const proj = result.find((r) => r.projectKey === "PROJ");
		expect(proj?.members).toHaveLength(2);
		expect(proj?.members.find((m) => m.userId === "acc-1")?.name).toBe("Alice");
		expect(proj?.members.find((m) => m.userId === "acc-2")?.name).toBe("Bob");

		const other = result.find((r) => r.projectKey === "OTHER");
		expect(other?.members).toHaveLength(1);
		expect(other?.members[0]?.userId).toBe("acc-1");
	});

	test("skips issues with no assignee", () => {
		const issues: JiraIssue[] = [
			makeIssue({ key: "PROJ-1", projectKey: "PROJ", assigneeId: null, assigneeName: null }),
			makeIssue({
				key: "PROJ-2",
				projectKey: "PROJ",
				assigneeId: "acc-1",
				assigneeName: "Alice",
				assigneeAvatar: null,
			}),
		];

		const result = extractJiraAssignees(issues);
		const proj = result.find((r) => r.projectKey === "PROJ");
		expect(proj?.members).toHaveLength(1);
		expect(proj?.members[0]?.userId).toBe("acc-1");
	});

	test("deduplicates the same assignee appearing on multiple issues", () => {
		const issues: JiraIssue[] = [
			makeIssue({
				key: "PROJ-1",
				projectKey: "PROJ",
				assigneeId: "acc-1",
				assigneeName: "Alice",
				assigneeAvatar: null,
			}),
			makeIssue({
				key: "PROJ-2",
				projectKey: "PROJ",
				assigneeId: "acc-1",
				assigneeName: "Alice",
				assigneeAvatar: null,
			}),
		];

		const result = extractJiraAssignees(issues);
		const proj = result.find((r) => r.projectKey === "PROJ");
		expect(proj?.members).toHaveLength(1);
	});

	test("returns empty array for no issues", () => {
		expect(extractJiraAssignees([])).toEqual([]);
	});

	test("preserves avatarUrl or null", () => {
		const issues: JiraIssue[] = [
			makeIssue({
				key: "PROJ-1",
				projectKey: "PROJ",
				assigneeId: "acc-1",
				assigneeName: "Alice",
				assigneeAvatar: "https://cdn/alice.png",
			}),
		];
		const result = extractJiraAssignees(issues);
		expect(result[0]?.members[0]?.avatarUrl).toBe("https://cdn/alice.png");
	});

	test("uses null avatarUrl when issue has null assigneeAvatar", () => {
		const issues: JiraIssue[] = [
			makeIssue({
				key: "PROJ-1",
				projectKey: "PROJ",
				assigneeId: "acc-1",
				assigneeName: "Alice",
				assigneeAvatar: null,
			}),
		];
		const result = extractJiraAssignees(issues);
		expect(result[0]?.members[0]?.avatarUrl).toBeNull();
	});

	test("skips issues where assigneeId is present but assigneeName is null", () => {
		const issues: JiraIssue[] = [
			makeIssue({ key: "PROJ-1", projectKey: "PROJ", assigneeId: "acc-1", assigneeName: null }),
		];
		expect(extractJiraAssignees(issues)).toEqual([]);
	});
});
