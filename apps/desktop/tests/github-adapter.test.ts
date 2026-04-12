import { describe, expect, test } from "bun:test";
import { joinCacheKey, splitCacheKey } from "../src/main/providers/github-cache-key";

// Pure mapping helpers mirroring the adapter's normalization logic — tested
// in isolation so no Electron / DB imports are needed.

interface GitHubPRInput {
	number: number;
	title?: string | null;
	url?: string | null;
	branchName?: string | null;
	state?: string | null;
	isDraft?: boolean;
	repoOwner?: string | null;
	repoName?: string | null;
	role?: "author" | "reviewer" | null;
	reviewDecision?: string | null;
	commentCount?: number;
}

interface GitHubCommentInput {
	id: number;
	body?: string | null;
	author?: string | null;
	createdAt?: string | null;
	kind?: "issue" | "review";
	path?: string | null;
	line?: number | null;
}

interface PRStateInput {
	headSha?: string | null;
	state?: string | null;
	merged?: boolean;
}

// ── Pure mapping functions that mirror the adapter ────────────────────────

function normalizePR(pr: GitHubPRInput) {
	return {
		id: pr.number,
		title: pr.title ?? "",
		state: pr.state === "open" ? ("open" as const) : ("closed" as const),
		author: pr.repoOwner ?? "Unknown",
		webUrl: pr.url ?? "",
		sourceBranch: pr.branchName ?? "",
		targetBranch: "",
		role: pr.role ?? "author",
		repoOwner: pr.repoOwner ?? "",
		repoName: pr.repoName ?? "",
	};
}

function normalizeComment(c: GitHubCommentInput) {
	return {
		id: String(c.id),
		body: c.body ?? "",
		author: c.author ?? "Unknown",
		filePath: c.path ?? null,
		lineNumber: c.line ?? null,
		createdAt: c.createdAt ?? "",
	};
}

function normalizePRState(result: PRStateInput) {
	return {
		headSha: result.headSha ?? "",
		state: result.merged
			? ("merged" as const)
			: result.state === "open"
				? ("open" as const)
				: ("closed" as const),
	};
}

// ── normalizePR tests ─────────────────────────────────────────────────────

describe("normalizePR", () => {
	test("maps all populated fields correctly", () => {
		const pr: GitHubPRInput = {
			number: 42,
			title: "Add dark mode",
			url: "https://github.com/org/repo/pull/42",
			branchName: "feat/dark-mode",
			state: "open",
			repoOwner: "org",
			repoName: "repo",
			role: "author",
		};

		expect(normalizePR(pr)).toEqual({
			id: 42,
			title: "Add dark mode",
			state: "open",
			author: "org",
			webUrl: "https://github.com/org/repo/pull/42",
			sourceBranch: "feat/dark-mode",
			targetBranch: "",
			role: "author",
			repoOwner: "org",
			repoName: "repo",
		});
	});

	test("uses number as id", () => {
		const pr: GitHubPRInput = { number: 99 };
		expect(normalizePR(pr).id).toBe(99);
	});

	test("falls back to empty string when title is null", () => {
		expect(normalizePR({ number: 1, title: null }).title).toBe("");
	});

	test("falls back to empty string when title is undefined", () => {
		expect(normalizePR({ number: 1 }).title).toBe("");
	});

	test("maps closed state", () => {
		expect(normalizePR({ number: 1, state: "closed" }).state).toBe("closed");
	});

	test("maps any non-open state to closed", () => {
		expect(normalizePR({ number: 1, state: "merged" }).state).toBe("closed");
	});

	test("falls back to empty string when url is null", () => {
		expect(normalizePR({ number: 1, url: null }).webUrl).toBe("");
	});

	test("falls back to empty string when branchName is null", () => {
		expect(normalizePR({ number: 1, branchName: null }).sourceBranch).toBe("");
	});

	test("falls back to Unknown when repoOwner is null", () => {
		expect(normalizePR({ number: 1, repoOwner: null }).author).toBe("Unknown");
	});

	test("falls back to author when role is null", () => {
		expect(normalizePR({ number: 1, role: null }).role).toBe("author");
	});

	test("preserves reviewer role", () => {
		expect(normalizePR({ number: 1, role: "reviewer" }).role).toBe("reviewer");
	});

	test("targetBranch is always empty string (not in search result)", () => {
		expect(normalizePR({ number: 1 }).targetBranch).toBe("");
	});

	test("includes repoOwner from pr.repoOwner", () => {
		expect(normalizePR({ number: 1, repoOwner: "acme-org" }).repoOwner).toBe("acme-org");
	});

	test("falls back to empty string when repoOwner is null", () => {
		expect(normalizePR({ number: 1, repoOwner: null }).repoOwner).toBe("");
	});

	test("includes repoName from pr.repoName", () => {
		expect(normalizePR({ number: 1, repoName: "my-repo" }).repoName).toBe("my-repo");
	});

	test("falls back to empty string when repoName is null", () => {
		expect(normalizePR({ number: 1, repoName: null }).repoName).toBe("");
	});
});

// ── normalizeComment tests ────────────────────────────────────────────────

describe("normalizeComment", () => {
	test("maps all populated fields correctly", () => {
		const c: GitHubCommentInput = {
			id: 1001,
			body: "Looks good!",
			author: "alice",
			createdAt: "2026-01-01T00:00:00Z",
			kind: "issue",
			path: "src/main.ts",
			line: 42,
		};

		expect(normalizeComment(c)).toEqual({
			id: "1001",
			body: "Looks good!",
			author: "alice",
			filePath: "src/main.ts",
			lineNumber: 42,
			createdAt: "2026-01-01T00:00:00Z",
		});
	});

	test("converts numeric id to string", () => {
		expect(normalizeComment({ id: 9999 }).id).toBe("9999");
	});

	test("falls back to empty string when body is null", () => {
		expect(normalizeComment({ id: 1, body: null }).body).toBe("");
	});

	test("falls back to Unknown when author is null", () => {
		expect(normalizeComment({ id: 1, author: null }).author).toBe("Unknown");
	});

	test("falls back to null when path is null", () => {
		expect(normalizeComment({ id: 1, path: null }).filePath).toBeNull();
	});

	test("falls back to null when path is undefined", () => {
		expect(normalizeComment({ id: 1 }).filePath).toBeNull();
	});

	test("falls back to null when line is null", () => {
		expect(normalizeComment({ id: 1, line: null }).lineNumber).toBeNull();
	});

	test("falls back to null when line is undefined", () => {
		expect(normalizeComment({ id: 1 }).lineNumber).toBeNull();
	});

	test("falls back to empty string when createdAt is null", () => {
		expect(normalizeComment({ id: 1, createdAt: null }).createdAt).toBe("");
	});
});

// ── normalizePRState tests ────────────────────────────────────────────────

describe("normalizePRState", () => {
	test("maps open PR state", () => {
		expect(normalizePRState({ headSha: "abc123", state: "open", merged: false })).toEqual({
			headSha: "abc123",
			state: "open",
		});
	});

	test("maps closed PR state", () => {
		expect(normalizePRState({ headSha: "def456", state: "closed", merged: false })).toEqual({
			headSha: "def456",
			state: "closed",
		});
	});

	test("merged flag takes priority and maps to merged state", () => {
		expect(normalizePRState({ headSha: "ghi789", state: "closed", merged: true })).toEqual({
			headSha: "ghi789",
			state: "merged",
		});
	});

	test("falls back to empty string when headSha is null", () => {
		expect(normalizePRState({ headSha: null, state: "open", merged: false }).headSha).toBe("");
	});

	test("falls back to empty string when headSha is undefined", () => {
		expect(normalizePRState({ state: "open", merged: false }).headSha).toBe("");
	});

	test("falls back to closed when state is undefined and not merged", () => {
		expect(normalizePRState({}).state).toBe("closed");
	});
});

describe("GitHubAdapter.getPRCommentsIfChanged", () => {
	test("splitCacheKey round-trips with joinCacheKey", () => {
		const issueEtag = '"etag-issue"';
		const reviewEtag = '"etag-review"';
		const joined = joinCacheKey(issueEtag, reviewEtag);
		const [i, r] = splitCacheKey(joined);
		expect(i).toBe(issueEtag);
		expect(r).toBe(reviewEtag);
	});

	test("joinCacheKey combines with pipe separator", () => {
		const joined = joinCacheKey('"a"', '"b"');
		expect(joined).toBe('"a"|"b"');
	});

	test("splitCacheKey handles missing separator gracefully", () => {
		const [i, r] = splitCacheKey('"only"');
		expect(i).toBe('"only"');
		expect(r).toBe('"only"');
	});
});
