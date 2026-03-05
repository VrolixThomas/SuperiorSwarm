import { describe, expect, test } from "bun:test";
import { mapCommentNode, mapPRNode } from "../src/main/github/github";

describe("mapPRNode", () => {
	test("maps an authored PR node to GitHubPR", () => {
		const node = {
			id: 1001,
			number: 42,
			title: "Fix the login bug",
			html_url: "https://github.com/acme/app/pull/42",
			state: "open" as const,
			draft: false,
			comments: 3,
			pull_request: {
				url: "https://api.github.com/repos/acme/app/pulls/42",
				review_comments: 2,
			},
			repository_url: "https://api.github.com/repos/acme/app",
		};

		const result = mapPRNode(node, "author", "fix-login-bug");

		expect(result).toEqual({
			id: 1001,
			number: 42,
			title: "Fix the login bug",
			url: "https://github.com/acme/app/pull/42",
			branchName: "fix-login-bug",
			state: "open",
			isDraft: false,
			repoOwner: "acme",
			repoName: "app",
			role: "author",
			reviewDecision: null,
			commentCount: 5,
		});
	});

	test("maps a reviewer PR node with role reviewer", () => {
		const node = {
			id: 2002,
			number: 7,
			title: "Add dark mode",
			html_url: "https://github.com/org/repo/pull/7",
			state: "open" as const,
			draft: true,
			comments: 0,
			pull_request: {
				url: "https://api.github.com/repos/org/repo/pulls/7",
				review_comments: 1,
			},
			repository_url: "https://api.github.com/repos/org/repo",
		};

		const result = mapPRNode(node, "reviewer", "add-dark-mode");

		expect(result.role).toBe("reviewer");
		expect(result.branchName).toBe("add-dark-mode");
		expect(result.isDraft).toBe(true);
		expect(result.repoOwner).toBe("org");
		expect(result.repoName).toBe("repo");
		expect(result.commentCount).toBe(1);
	});
});

describe("mapCommentNode", () => {
	test("maps an issue comment node", () => {
		const node = {
			id: 9001,
			body: "Looks good to me!",
			user: { login: "alice" },
			created_at: "2026-03-01T10:00:00Z",
		};

		const result = mapCommentNode(node, "issue");

		expect(result).toEqual({
			id: 9001,
			body: "Looks good to me!",
			author: "alice",
			createdAt: "2026-03-01T10:00:00Z",
			kind: "issue",
			path: undefined,
			line: undefined,
		});
	});

	test("maps a review comment node with file path and line", () => {
		const node = {
			id: 9002,
			body: "Nit: rename this variable",
			user: { login: "bob" },
			created_at: "2026-03-02T12:00:00Z",
			path: "src/auth.ts",
			line: 47,
		};

		const result = mapCommentNode(node, "review");

		expect(result).toEqual({
			id: 9002,
			body: "Nit: rename this variable",
			author: "bob",
			createdAt: "2026-03-02T12:00:00Z",
			kind: "review",
			path: "src/auth.ts",
			line: 47,
		});
	});
});
