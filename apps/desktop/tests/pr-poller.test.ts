import { describe, expect, test } from "bun:test";
import { diffPRCache } from "../src/main/ai-review/pr-poller";
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
