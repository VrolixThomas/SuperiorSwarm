import { describe, expect, test } from "bun:test";
import type { BitbucketComment, BitbucketPullRequest } from "../src/main/atlassian/bitbucket";
import { paginateBitbucket } from "../src/main/atlassian/bitbucket";
import {
	dedupBitbucketPRs,
	mapBitbucketComment,
	mapBitbucketPR,
	normalizeBBState,
} from "../src/main/providers/bitbucket-adapter";

describe("normalizeBBState", () => {
	test("maps OPEN to open", () => {
		expect(normalizeBBState("OPEN")).toBe("open");
	});

	test("maps MERGED to merged", () => {
		expect(normalizeBBState("MERGED")).toBe("merged");
	});

	test("maps DECLINED to declined", () => {
		expect(normalizeBBState("DECLINED")).toBe("declined");
	});

	test("maps SUPERSEDED to closed", () => {
		expect(normalizeBBState("SUPERSEDED")).toBe("closed");
	});

	test("maps unknown state to closed", () => {
		expect(normalizeBBState("WHATEVER")).toBe("closed");
	});

	test("is case-insensitive", () => {
		expect(normalizeBBState("open")).toBe("open");
		expect(normalizeBBState("merged")).toBe("merged");
		expect(normalizeBBState("declined")).toBe("declined");
	});
});

describe("mapBitbucketPR", () => {
	test("maps a full PR to NormalizedPR as author role", () => {
		const pr: BitbucketPullRequest = {
			id: 42,
			title: "Add feature X",
			state: "OPEN",
			author: "alice",
			repoSlug: "my-repo",
			workspace: "my-workspace",
			webUrl: "https://bitbucket.org/my-workspace/my-repo/pull-requests/42",
			createdOn: "2026-01-01T00:00:00Z",
			updatedOn: "2026-01-02T00:00:00Z",
			source: { branch: { name: "feature/x" } },
			destination: { branch: { name: "main" } },
			headCommitSha: "",
		};

		const result = mapBitbucketPR(pr, "author");

		expect(result).toEqual({
			id: 42,
			title: "Add feature X",
			state: "open",
			author: "alice",
			webUrl: "https://bitbucket.org/my-workspace/my-repo/pull-requests/42",
			sourceBranch: "feature/x",
			targetBranch: "main",
			role: "author",
			repoOwner: "my-workspace",
			repoName: "my-repo",
			headCommitSha: "",
		});
	});

	test("maps a PR with reviewer role", () => {
		const pr: BitbucketPullRequest = {
			id: 7,
			title: "Fix bug",
			state: "OPEN",
			author: "bob",
			repoSlug: "other-repo",
			workspace: "org",
			webUrl: "https://bitbucket.org/org/other-repo/pull-requests/7",
			createdOn: "2026-02-01T00:00:00Z",
			updatedOn: "2026-02-02T00:00:00Z",
			source: { branch: { name: "bugfix/issue-123" } },
			destination: { branch: { name: "develop" } },
			headCommitSha: "",
		};

		const result = mapBitbucketPR(pr, "reviewer");

		expect(result.role).toBe("reviewer");
		expect(result.state).toBe("open");
	});

	test("maps MERGED state correctly", () => {
		const pr: BitbucketPullRequest = {
			id: 10,
			title: "Merge feature",
			state: "MERGED",
			author: "carol",
			repoSlug: "repo",
			workspace: "ws",
			webUrl: "https://bitbucket.org/ws/repo/pull-requests/10",
			createdOn: "2026-01-10T00:00:00Z",
			updatedOn: "2026-01-15T00:00:00Z",
			source: { branch: { name: "feature/done" } },
			destination: { branch: { name: "main" } },
			headCommitSha: "",
		};

		expect(mapBitbucketPR(pr, "author").state).toBe("merged");
	});

	test("maps DECLINED state correctly", () => {
		const pr: BitbucketPullRequest = {
			id: 11,
			title: "Declined PR",
			state: "DECLINED",
			author: "dave",
			repoSlug: "repo",
			workspace: "ws",
			webUrl: "https://bitbucket.org/ws/repo/pull-requests/11",
			createdOn: "2026-01-05T00:00:00Z",
			updatedOn: "2026-01-06T00:00:00Z",
			source: { branch: { name: "bad-idea" } },
			destination: { branch: { name: "main" } },
			headCommitSha: "",
		};

		expect(mapBitbucketPR(pr, "author").state).toBe("declined");
	});

	test("falls back to empty string when source branch is missing", () => {
		const pr: BitbucketPullRequest = {
			id: 20,
			title: "No source branch",
			state: "OPEN",
			author: "eve",
			repoSlug: "repo",
			workspace: "ws",
			webUrl: "https://bitbucket.org/ws/repo/pull-requests/20",
			createdOn: "2026-01-01T00:00:00Z",
			updatedOn: "2026-01-01T00:00:00Z",
			source: undefined,
			destination: { branch: { name: "main" } },
			headCommitSha: "",
		};

		const result = mapBitbucketPR(pr, "author");
		expect(result.sourceBranch).toBe("");
	});

	test("maps repoOwner from workspace and repoName from repoSlug", () => {
		const pr: BitbucketPullRequest = {
			id: 1,
			title: "Test",
			state: "OPEN",
			author: "alice",
			repoSlug: "my-repo",
			workspace: "my-workspace",
			webUrl: "https://bitbucket.org/my-workspace/my-repo/pull-requests/1",
			createdOn: "2026-01-01T00:00:00Z",
			updatedOn: "2026-01-02T00:00:00Z",
			headCommitSha: "",
		};
		const result = mapBitbucketPR(pr, "author");
		expect(result.repoOwner).toBe("my-workspace");
		expect(result.repoName).toBe("my-repo");
	});

	test("falls back to empty string when destination is null", () => {
		const pr: BitbucketPullRequest = {
			id: 21,
			title: "No destination",
			state: "OPEN",
			author: "frank",
			repoSlug: "repo",
			workspace: "ws",
			webUrl: "https://bitbucket.org/ws/repo/pull-requests/21",
			createdOn: "2026-01-01T00:00:00Z",
			updatedOn: "2026-01-01T00:00:00Z",
			source: { branch: { name: "feature/y" } },
			destination: undefined,
			headCommitSha: "",
		};

		const result = mapBitbucketPR(pr, "author");
		expect(result.targetBranch).toBe("");
	});
});

describe("mapBitbucketComment", () => {
	test("maps a full comment to NormalizedComment", () => {
		const comment: BitbucketComment = {
			id: 100,
			body: "Looks good!",
			author: "alice",
			filePath: "src/index.ts",
			lineNumber: 42,
			createdAt: "2026-03-01T10:00:00Z",
		};

		const result = mapBitbucketComment(comment);

		expect(result).toEqual({
			id: "100",
			body: "Looks good!",
			author: "alice",
			filePath: "src/index.ts",
			lineNumber: 42,
			side: null,
			createdAt: "2026-03-01T10:00:00Z",
		});
	});

	test("maps a comment with null filePath and lineNumber", () => {
		const comment: BitbucketComment = {
			id: 200,
			body: "General comment",
			author: "bob",
			filePath: null,
			lineNumber: null,
			createdAt: "2026-03-02T12:00:00Z",
		};

		const result = mapBitbucketComment(comment);

		expect(result.id).toBe("200");
		expect(result.filePath).toBeNull();
		expect(result.lineNumber).toBeNull();
		expect(result.body).toBe("General comment");
	});

	test("converts numeric id to string", () => {
		const comment: BitbucketComment = {
			id: 999,
			body: "Test",
			author: "carol",
			filePath: null,
			lineNumber: null,
			createdAt: "2026-03-03T00:00:00Z",
		};

		const result = mapBitbucketComment(comment);
		expect(typeof result.id).toBe("string");
		expect(result.id).toBe("999");
	});
});

describe("dedupBitbucketPRs", () => {
	function pr(workspace: string, repoSlug: string, id: number): BitbucketPullRequest {
		return {
			id,
			title: `pr ${id}`,
			state: "OPEN",
			author: "alice",
			repoSlug,
			workspace,
			webUrl: "",
			createdOn: "",
			updatedOn: "",
			source: { branch: { name: "src" } },
			destination: { branch: { name: "main" } },
			headCommitSha: "",
		};
	}

	test("does not collapse PR #1 from two different repos in the same workspace", () => {
		const result = dedupBitbucketPRs([pr("ws", "repoA", 1), pr("ws", "repoB", 1)], []);
		expect(result.map((r) => `${r.repoOwner}/${r.repoName}#${r.id}`)).toEqual([
			"ws/repoA#1",
			"ws/repoB#1",
		]);
		expect(result.every((r) => r.role === "author")).toBe(true);
	});

	test("collapses true duplicates within the authored list", () => {
		const result = dedupBitbucketPRs([pr("ws", "repoA", 1), pr("ws", "repoA", 1)], []);
		expect(result).toHaveLength(1);
	});

	test("merges reviewer entries that don't overlap with authored", () => {
		const result = dedupBitbucketPRs([pr("ws", "repoA", 1)], [pr("ws", "repoB", 2)]);
		expect(result.map((r) => r.role)).toEqual(["author", "reviewer"]);
		expect(result).toHaveLength(2);
	});

	test("when a PR is in both authored and reviewing, the authored entry wins", () => {
		const result = dedupBitbucketPRs([pr("ws", "repoA", 1)], [pr("ws", "repoA", 1)]);
		expect(result).toHaveLength(1);
		expect(result[0]?.role).toBe("author");
	});

	test("does NOT collapse PR #1 in repoA-author with PR #1 in repoB-reviewer", () => {
		const result = dedupBitbucketPRs([pr("ws", "repoA", 1)], [pr("ws", "repoB", 1)]);
		expect(result).toHaveLength(2);
		expect(result.map((r) => r.role)).toEqual(["author", "reviewer"]);
	});
});

describe("mapBitbucketPR head commit SHA plumbing", () => {
	test("forwards source.commit.hash from BitbucketPullRequest to NormalizedPR.headCommitSha", () => {
		const pr: BitbucketPullRequest = {
			id: 7,
			title: "feat: thing",
			state: "OPEN",
			author: "alice",
			repoSlug: "repoA",
			workspace: "ws",
			webUrl: "https://example.test",
			createdOn: "2026-01-01",
			updatedOn: "2026-01-02",
			source: { branch: { name: "feature/thing" } },
			destination: { branch: { name: "main" } },
			headCommitSha: "deadbeef",
		};

		const result = mapBitbucketPR(pr, "author");

		expect(result.headCommitSha).toBe("deadbeef");
	});

	test("falls back to empty string when headCommitSha is empty", () => {
		const pr: BitbucketPullRequest = {
			id: 8,
			title: "feat: thing",
			state: "OPEN",
			author: "alice",
			repoSlug: "repoA",
			workspace: "ws",
			webUrl: "",
			createdOn: "",
			updatedOn: "",
			source: { branch: { name: "src" } },
			destination: { branch: { name: "main" } },
			headCommitSha: "",
		};

		expect(mapBitbucketPR(pr, "author").headCommitSha).toBe("");
	});
});

describe("BitbucketAdapter.getPRCommentsIfChanged", () => {
	test("mapBitbucketComment maps all fields correctly", () => {
		const comment: BitbucketComment = {
			id: 1,
			body: "Fix this",
			author: "alice",
			filePath: "src/index.ts",
			lineNumber: 10,
			createdAt: "2026-01-01T00:00:00Z",
		};
		const result = mapBitbucketComment(comment);
		expect(result.id).toBe("1");
		expect(result.body).toBe("Fix this");
		expect(result.filePath).toBe("src/index.ts");
		expect(result.lineNumber).toBe(10);
	});
});

describe("paginateBitbucket", () => {
	test("returns the values from a single page", async () => {
		const pages = new Map<string, { values: string[]; next?: string }>([
			["page-1", { values: ["a", "b", "c"] }],
		]);
		const result = await paginateBitbucket<string>("page-1", async (url) => {
			const page = pages.get(url);
			if (!page) throw new Error(`unexpected url: ${url}`);
			return page;
		});
		expect(result).toEqual(["a", "b", "c"]);
	});

	test("walks the `next` chain across multiple pages", async () => {
		const pages = new Map<string, { values: string[]; next?: string }>([
			["page-1", { values: ["a", "b"], next: "page-2" }],
			["page-2", { values: ["c", "d"], next: "page-3" }],
			["page-3", { values: ["e"] }],
		]);
		const fetched: string[] = [];
		const result = await paginateBitbucket<string>("page-1", async (url) => {
			fetched.push(url);
			return pages.get(url) ?? { values: [] };
		});
		expect(result).toEqual(["a", "b", "c", "d", "e"]);
		expect(fetched).toEqual(["page-1", "page-2", "page-3"]);
	});

	test("throws if any page in the chain throws (strict failure)", async () => {
		const pages = new Map<string, { values: string[]; next?: string }>([
			["page-1", { values: ["a"], next: "page-2" }],
		]);
		await expect(
			paginateBitbucket<string>("page-1", async (url) => {
				const page = pages.get(url);
				if (!page) throw new Error(`fetch failed: ${url}`);
				return page;
			})
		).rejects.toThrow("fetch failed: page-2");
	});

	test("returns empty array when first page has no values", async () => {
		const result = await paginateBitbucket<string>("page-1", async () => ({ values: [] }));
		expect(result).toEqual([]);
	});
});
