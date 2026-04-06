import { describe, expect, test } from "bun:test";
import { mapJiraIssue, mapJiraIssueDetail } from "../src/main/providers/jira-adapter";

describe("mapJiraIssue", () => {
	test("maps a full JiraIssue to NormalizedIssue", () => {
		const issue = {
			key: "PROJ-123",
			summary: "Fix the login bug",
			status: "In Progress",
			statusCategory: "indeterminate",
			statusColor: "#0052CC",
			priority: "High",
			issueType: "Bug",
			projectKey: "PROJ",
			webUrl: "https://acme.atlassian.net/browse/PROJ-123",
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-02T00:00:00Z",
		};

		const result = mapJiraIssue(issue);

		expect(result).toEqual({
			id: "PROJ-123",
			identifier: "PROJ-123",
			title: "Fix the login bug",
			url: "https://acme.atlassian.net/browse/PROJ-123",
			status: "In Progress",
			statusCategory: "indeterminate",
			statusColor: "#0052CC",
		});
	});

	test("falls back to empty strings and default color when fields are missing", () => {
		const issue = {
			key: "",
			summary: "",
			status: "",
			statusCategory: "",
			statusColor: "",
			priority: "None",
			issueType: "Task",
			projectKey: "",
			webUrl: "",
			createdAt: "",
			updatedAt: "",
		};

		const result = mapJiraIssue(issue);

		expect(result.id).toBe("");
		expect(result.identifier).toBe("");
		expect(result.title).toBe("");
		expect(result.url).toBe("");
		expect(result.status).toBe("");
		expect(result.statusCategory).toBe("");
		expect(result.statusColor).toBe("#808080");
	});

	test("uses #808080 fallback when statusColor is empty string", () => {
		const issue = {
			key: "ABC-1",
			summary: "Test",
			status: "Open",
			statusCategory: "new",
			statusColor: "",
			priority: "Low",
			issueType: "Story",
			projectKey: "ABC",
			webUrl: "https://acme.atlassian.net/browse/ABC-1",
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
		};

		const result = mapJiraIssue(issue);

		expect(result.statusColor).toBe("#808080");
	});
});

describe("mapJiraIssueDetail", () => {
	test("maps a full JiraIssueDetail to NormalizedIssueDetail", () => {
		const detail = {
			description: "This is a description.",
			comments: [
				{
					id: "c1",
					author: "Alice",
					avatarUrl: "https://cdn.example.com/alice.png",
					body: "Looks good!",
					createdAt: "2026-01-03T10:00:00Z",
				},
			],
		};

		const result = mapJiraIssueDetail(detail);

		expect(result.description).toBe("This is a description.");
		expect(result.comments).toHaveLength(1);
		expect(result.comments[0]).toEqual({
			id: "c1",
			author: "Alice",
			avatarUrl: "https://cdn.example.com/alice.png",
			body: "Looks good!",
			createdAt: "2026-01-03T10:00:00Z",
		});
	});

	test("maps null description to empty string", () => {
		const detail = {
			description: null as unknown as string,
			comments: [],
		};

		const result = mapJiraIssueDetail(detail);

		expect(result.description).toBe("");
	});

	test("maps null author in a comment to empty string", () => {
		const detail = {
			description: "Some text",
			comments: [
				{
					id: "c2",
					author: null as unknown as string,
					body: "A comment",
					createdAt: "2026-01-04T08:00:00Z",
				},
			],
		};

		const result = mapJiraIssueDetail(detail);

		expect(result.comments[0]?.author).toBe("");
	});

	test("maps null body in a comment to empty string", () => {
		const detail = {
			description: "Some text",
			comments: [
				{
					id: "c3",
					author: "Bob",
					body: null as unknown as string,
					createdAt: "2026-01-05T09:00:00Z",
				},
			],
		};

		const result = mapJiraIssueDetail(detail);

		expect(result.comments[0]?.body).toBe("");
	});

	test("preserves avatarUrl as undefined when absent", () => {
		const detail = {
			description: "Desc",
			comments: [
				{
					id: "c4",
					author: "Carol",
					body: "Hello",
					createdAt: "2026-01-06T11:00:00Z",
				},
			],
		};

		const result = mapJiraIssueDetail(detail);

		expect(result.comments[0]?.avatarUrl).toBeUndefined();
	});
});
