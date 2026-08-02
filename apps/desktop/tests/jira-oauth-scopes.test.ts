import { describe, expect, test } from "bun:test";
import { JIRA_SCOPES } from "../src/main/atlassian/constants";

describe("Jira OAuth scopes", () => {
	test("always retains the released Jira connection scopes", () => {
		const scopes = new Set(JIRA_SCOPES.split(" "));
		expect(scopes.has("read:jira-work")).toBeTrue();
		expect(scopes.has("read:jira-user")).toBeTrue();
		expect(scopes.has("offline_access")).toBeTrue();
	});

	test("always requests the Jira Software planning and issue-write scopes", () => {
		const scopes = new Set(JIRA_SCOPES.split(" "));

		for (const requiredScope of [
			"read:board-scope:jira-software",
			"read:board-scope.admin:jira-software",
			"read:sprint:jira-software",
			"read:issue-details:jira",
			"read:project:jira",
			"read:jql:jira",
			"write:issue:jira",
		]) {
			expect(scopes.has(requiredScope)).toBeTrue();
		}
	});
});
