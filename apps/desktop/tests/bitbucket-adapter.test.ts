import { describe, expect, test } from "bun:test";
import type { BitbucketComment, BitbucketPullRequest } from "../src/main/atlassian/bitbucket";
import {
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
