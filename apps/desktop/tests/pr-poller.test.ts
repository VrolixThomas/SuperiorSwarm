import { describe, expect, test } from "bun:test";
import { diffPRCache, diffTrackedPrs, rowToCachedPR } from "../src/main/ai-review/pr-poller";
import type { TrackedPr } from "../src/main/db/schema";
import type { CachedPR } from "../src/shared/review-types";

describe("PR poller cache", () => {
	test("detectNewPRs identifies PRs not in cache", () => {
		const cache = new Map<string, { identifier: string }>();
		cache.set("owner/repo#1", { identifier: "owner/repo#1" });

		const fetched = [{ identifier: "owner/repo#1" }, { identifier: "owner/repo#2" }];

		const newPRs = fetched.filter((pr) => !cache.has(pr.identifier));
		expect(newPRs).toHaveLength(1);
		expect(newPRs[0].identifier).toBe("owner/repo#2");
	});

	test("detectClosedPRs identifies PRs no longer in fetched list", () => {
		const cache = new Map<string, { identifier: string; state: string }>();
		cache.set("owner/repo#1", { identifier: "owner/repo#1", state: "open" });
		cache.set("owner/repo#2", { identifier: "owner/repo#2", state: "open" });

		const fetched = [
			{ identifier: "owner/repo#1", state: "open" },
			{ identifier: "owner/repo#2", state: "merged" },
		];

		const closed = fetched.filter((pr) => pr.state === "merged" || pr.state === "declined");
		expect(closed).toHaveLength(1);
	});
});

function makePR(provider: "github" | "bitbucket", id: number, owner = "o", repo = "r"): CachedPR {
	return {
		provider,
		identifier: `${owner}/${repo}#${id}`,
		number: id,
		title: `PR ${id}`,
		state: "open",
		sourceBranch: "src",
		targetBranch: "main",
		author: { login: "u", avatarUrl: "" },
		reviewers: [],
		ciStatus: null,
		commentCount: 0,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		updatedAt: "",
		repoOwner: owner,
		repoName: repo,
		projectId: "",
		role: "reviewer",
		headCommitSha: "",
	};
}

describe("diffPRCache", () => {
	test("flags brand-new PRs as new", () => {
		const cache = new Map<string, CachedPR>();
		const fetched = [makePR("github", 1), makePR("github", 2)];
		const result = diffPRCache(cache, fetched, new Set(["github"]));
		expect(result.newPRs.map((p) => p.identifier)).toEqual(["o/r#1", "o/r#2"]);
		expect(result.toDelete).toEqual([]);
	});

	test("does not re-flag PRs already in cache", () => {
		const cache = new Map<string, CachedPR>();
		cache.set("o/r#1", makePR("github", 1));
		const fetched = [makePR("github", 1), makePR("github", 2)];
		const result = diffPRCache(cache, fetched, new Set(["github"]));
		expect(result.newPRs.map((p) => p.identifier)).toEqual(["o/r#2"]);
	});

	test("removes cached entries that disappeared from a SUCCESSFUL provider", () => {
		const cache = new Map<string, CachedPR>();
		cache.set("o/r#1", makePR("github", 1));
		cache.set("o/r#2", makePR("github", 2));
		const fetched = [makePR("github", 1)];
		const result = diffPRCache(cache, fetched, new Set(["github"]));
		expect(result.toDelete).toEqual(["o/r#2"]);
	});

	test("KEEPS cached entries when their provider failed (partial fetch)", () => {
		const cache = new Map<string, CachedPR>();
		cache.set("o/r#1", makePR("github", 1));
		cache.set("o/r#2", makePR("bitbucket", 2));
		// Only github succeeded; bitbucket fetch failed and returned nothing.
		const fetched = [makePR("github", 1)];
		const result = diffPRCache(cache, fetched, new Set(["github"]));
		expect(result.toDelete).toEqual([]);
	});

	test("does NOT flag PRs as new when their provider failed and they happen to be missing", () => {
		const cache = new Map<string, CachedPR>();
		cache.set("o/r#1", makePR("bitbucket", 1));
		// Bitbucket failed; nothing fetched. Cached PR must remain, no new-event.
		const fetched: CachedPR[] = [];
		const result = diffPRCache(cache, fetched, new Set());
		expect(result.newPRs).toEqual([]);
		expect(result.toDelete).toEqual([]);
	});
});

describe("rowToCachedPR", () => {
	const baseRow: TrackedPr = {
		provider: "github",
		identifier: "acme/widgets#42",
		repoOwner: "acme",
		repoName: "widgets",
		number: 42,
		projectId: "project-1",
		title: "Add widgets",
		state: "open",
		sourceBranch: "feature/widgets",
		targetBranch: "main",
		role: "reviewer",
		headCommitSha: "abc123",
		authorLogin: "alice",
		authorAvatarUrl: null,
		firstSeenAt: new Date(1_700_000_000_000),
		lastSeenAt: new Date(1_700_000_000_000),
		stateChangedAt: null,
		updatedAt: new Date(1_700_000_000_000),
		autoReviewFirstTriggeredAt: null,
		autoReviewLastTriggeredSha: null,
	};

	test("maps every column the renderer reads", () => {
		const pr = rowToCachedPR(baseRow);
		expect(pr.provider).toBe("github");
		expect(pr.identifier).toBe("acme/widgets#42");
		expect(pr.number).toBe(42);
		expect(pr.title).toBe("Add widgets");
		expect(pr.state).toBe("open");
		expect(pr.sourceBranch).toBe("feature/widgets");
		expect(pr.targetBranch).toBe("main");
		expect(pr.role).toBe("reviewer");
		expect(pr.headCommitSha).toBe("abc123");
		expect(pr.repoOwner).toBe("acme");
		expect(pr.repoName).toBe("widgets");
		expect(pr.projectId).toBe("project-1");
		expect(pr.author).toEqual({ login: "alice", avatarUrl: "" });
	});

	test("fills placeholder fields the in-memory toCachedPR also hardcoded", () => {
		const pr = rowToCachedPR(baseRow);
		expect(pr.reviewers).toEqual([]);
		expect(pr.ciStatus).toBeNull();
		expect(pr.commentCount).toBe(0);
		expect(pr.changedFiles).toBe(0);
		expect(pr.additions).toBe(0);
		expect(pr.deletions).toBe(0);
	});

	test("treats null projectId as empty string", () => {
		const pr = rowToCachedPR({ ...baseRow, projectId: null });
		expect(pr.projectId).toBe("");
	});

	test("treats null head_commit_sha as empty string", () => {
		const pr = rowToCachedPR({ ...baseRow, headCommitSha: null });
		expect(pr.headCommitSha).toBe("");
	});

	test("treats null authorAvatarUrl as empty string", () => {
		const pr = rowToCachedPR({ ...baseRow, authorAvatarUrl: null });
		expect(pr.author.avatarUrl).toBe("");
	});

	test("declined state is preserved (Bitbucket)", () => {
		const pr = rowToCachedPR({ ...baseRow, state: "declined" });
		expect(pr.state).toBe("declined");
	});
});

describe("diffTrackedPrs", () => {
	function makeRow(
		provider: "github" | "bitbucket",
		identifier: string,
		overrides: Partial<TrackedPr> = {}
	): TrackedPr {
		return {
			provider,
			identifier,
			repoOwner: identifier.split("/")[0] ?? "",
			repoName: identifier.split("/")[1]?.split("#")[0] ?? "",
			number: Number(identifier.split("#")[1] ?? "0"),
			projectId: null,
			title: identifier,
			state: "open",
			sourceBranch: "src",
			targetBranch: "main",
			role: "reviewer",
			headCommitSha: "old-sha",
			authorLogin: "u",
			authorAvatarUrl: null,
			firstSeenAt: new Date(0),
			lastSeenAt: new Date(0),
			stateChangedAt: null,
			updatedAt: new Date(0),
			autoReviewFirstTriggeredAt: null,
			autoReviewLastTriggeredSha: null,
			...overrides,
		};
	}

	function makePR(
		provider: "github" | "bitbucket",
		id: number,
		overrides: Partial<CachedPR> = {}
	): CachedPR {
		return {
			provider,
			identifier: `o/r#${id}`,
			number: id,
			title: `PR ${id}`,
			state: "open",
			sourceBranch: "src",
			targetBranch: "main",
			author: { login: "u", avatarUrl: "" },
			reviewers: [],
			ciStatus: null,
			commentCount: 0,
			changedFiles: 0,
			additions: 0,
			deletions: 0,
			updatedAt: "",
			repoOwner: "o",
			repoName: "r",
			projectId: "",
			role: "reviewer",
			headCommitSha: "new-sha",
			...overrides,
		};
	}

	test("flags brand-new PRs as new", () => {
		const result = diffTrackedPrs({
			existingRows: [],
			fetched: [makePR("github", 1), makePR("github", 2)],
			successfulProviders: new Set(["github"]),
		});
		expect(result.newPRs.map((p) => p.identifier)).toEqual(["o/r#1", "o/r#2"]);
		expect(result.closedPRs).toEqual([]);
		expect(result.commitChangedPRs).toEqual([]);
	});

	test("does NOT flag PRs that already exist in the row set", () => {
		const result = diffTrackedPrs({
			existingRows: [makeRow("github", "o/r#1", { headCommitSha: "new-sha" })],
			fetched: [makePR("github", 1), makePR("github", 2)],
			successfulProviders: new Set(["github"]),
		});
		expect(result.newPRs.map((p) => p.identifier)).toEqual(["o/r#2"]);
	});

	test("flags closed PRs when state flips from open in fetched set", () => {
		const result = diffTrackedPrs({
			existingRows: [makeRow("github", "o/r#1", { state: "open", headCommitSha: "sha" })],
			fetched: [makePR("github", 1, { state: "merged", headCommitSha: "sha" })],
			successfulProviders: new Set(["github"]),
		});
		expect(result.closedPRs.map((p) => p.identifier)).toEqual(["o/r#1"]);
	});

	test("does NOT flag closed when previous state was already non-open", () => {
		const result = diffTrackedPrs({
			existingRows: [makeRow("github", "o/r#1", { state: "merged" })],
			fetched: [makePR("github", 1, { state: "merged" })],
			successfulProviders: new Set(["github"]),
		});
		expect(result.closedPRs).toEqual([]);
	});

	test("flags commit changes when fetched headCommitSha differs from row", () => {
		const result = diffTrackedPrs({
			existingRows: [makeRow("github", "o/r#1", { headCommitSha: "old-sha" })],
			fetched: [makePR("github", 1, { headCommitSha: "new-sha" })],
			successfulProviders: new Set(["github"]),
		});
		expect(result.commitChangedPRs).toHaveLength(1);
		expect(result.commitChangedPRs[0]?.previousSha).toBe("old-sha");
		expect(result.commitChangedPRs[0]?.pr.headCommitSha).toBe("new-sha");
	});

	test("does NOT flag commit change when fetched sha is empty", () => {
		const result = diffTrackedPrs({
			existingRows: [makeRow("github", "o/r#1", { headCommitSha: "old-sha" })],
			fetched: [makePR("github", 1, { headCommitSha: "" })],
			successfulProviders: new Set(["github"]),
		});
		expect(result.commitChangedPRs).toEqual([]);
	});

	test("does NOT flag commit change when previous sha is null", () => {
		const result = diffTrackedPrs({
			existingRows: [makeRow("github", "o/r#1", { headCommitSha: null })],
			fetched: [makePR("github", 1, { headCommitSha: "new-sha" })],
			successfulProviders: new Set(["github"]),
		});
		expect(result.commitChangedPRs).toEqual([]);
	});

	test("does NOT flag PRs from a failed provider as new", () => {
		// Bitbucket failed → not in successfulProviders → its rows are
		// preserved AND no diff is run for that provider in this cycle.
		const result = diffTrackedPrs({
			existingRows: [makeRow("bitbucket", "o/r#1", { headCommitSha: "old-sha" })],
			fetched: [],
			successfulProviders: new Set(["github"]), // bitbucket not in set
		});
		expect(result.newPRs).toEqual([]);
		expect(result.closedPRs).toEqual([]);
		expect(result.commitChangedPRs).toEqual([]);
	});
});
