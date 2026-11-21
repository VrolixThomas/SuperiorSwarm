import { describe, expect, test } from "bun:test";
import type { BitbucketPullRequest } from "../src/main/atlassian/bitbucket";
import type { GitHubPR } from "../src/main/github/github";
import {
	buildReviewQueue,
	nextPr,
	prevPr,
	queueStatus,
	reviewQueueKey,
} from "../src/renderer/lib/review-queue";
import type { CachedPR } from "../src/shared/review-types";

function github(number: number, patch: Partial<GitHubPR> = {}): GitHubPR {
	return {
		id: number,
		number,
		title: `PR ${number}`,
		url: "",
		branchName: "feature",
		state: "open",
		isDraft: false,
		repoOwner: "owner",
		repoName: "repo",
		role: "reviewer",
		reviewDecision: "review_required",
		commentCount: 0,
		...patch,
	};
}
function cached(number: number, patch: Partial<CachedPR> = {}): CachedPR {
	return {
		provider: "github",
		identifier: `owner/repo#${number}`,
		number,
		title: `Cached ${number}`,
		state: "open",
		sourceBranch: "feature",
		targetBranch: "main",
		author: { login: "other", avatarUrl: "" },
		reviewers: [],
		ciStatus: null,
		commentCount: 0,
		changedFiles: 7,
		additions: 0,
		deletions: 0,
		updatedAt: "",
		repoOwner: "owner",
		repoName: "repo",
		projectId: "project",
		role: "reviewer",
		headCommitSha: "head",
		...patch,
	};
}
describe("review queue", () => {
	test("normalizes Bitbucket requests and excludes authored cache matches", () => {
		const bitbucket = (id: number, state = "OPEN"): BitbucketPullRequest => ({
			id,
			title: `Bitbucket ${id}`,
			state,
			author: "other",
			workspace: "owner",
			repoSlug: "repo",
			webUrl: "",
			createdOn: "",
			updatedOn: "",
			source: { branch: { name: "source" } },
			destination: { branch: { name: "target" } },
			headCommitSha: "bb-head",
		});
		const queue = buildReviewQueue({
			bitbucket: [
				bitbucket(1),
				bitbucket(1),
				bitbucket(2, "MERGED"),
				bitbucket(3, "DECLINED"),
				bitbucket(4),
			],
			cached: [cached(4, { provider: "bitbucket", role: "author" })],
		});
		expect(queue.needsReview).toHaveLength(1);
		expect(queue.needsReview[0]).toMatchObject({
			key: "bitbucket:owner/repo#1",
			sourceBranch: "source",
			targetBranch: "target",
			headCommitSha: "bb-head",
		});
	});
	test("preserves provider list order, deduplicates cache, and separates known author work", () => {
		const queue = buildReviewQueue({
			github: [
				github(3),
				github(1),
				github(2, { reviewDecision: "changes_requested" }),
				github(4, { isDraft: true }),
			],
			cached: [cached(1), cached(5)],
		});
		expect(queue.needsReview.map((pr) => pr.number)).toEqual([3, 1, 5]);
		expect(queue.waitingOnAuthor.map((pr) => pr.number)).toEqual([2, 4]);
		expect(queue.needsReview[1]?.title).toBe("PR 1");
		expect(queue.needsReview[1]?.headCommitSha).toBe("head");
	});
	test("never reintroduces authored or closed PRs from stale cache", () => {
		const queue = buildReviewQueue({
			github: [github(1, { role: "author" }), github(2, { state: "closed" })],
			cached: [cached(1), cached(2), cached(3, { role: "author" }), cached(4, { state: "merged" })],
		});
		expect(queue.needsReview).toEqual([]);
		expect(queue.waitingOnAuthor).toEqual([]);
	});
	test("keeps identical repository slugs and PR numbers separate across providers", () => {
		const queue = buildReviewQueue({
			github: [github(1)],
			cached: [cached(1, { provider: "bitbucket" })],
		});
		expect(queue.needsReview.map((pr) => pr.key)).toEqual([
			"github:owner/repo#1",
			"bitbucket:owner/repo#1",
		]);
		expect(reviewQueueKey({ provider: "bitbucket", owner: "owner", repo: "repo", number: 1 })).toBe(
			"bitbucket:owner/repo#1"
		);
	});
	test("next and previous never wrap or include waiting PRs", () => {
		const queue = buildReviewQueue({
			github: [github(1), github(2), github(3, { isDraft: true })],
		});
		expect(nextPr(queue, "github:owner/repo#1")?.number).toBe(2);
		expect(prevPr(queue, "github:owner/repo#2")?.number).toBe(1);
		expect(nextPr(queue, "github:owner/repo#2")).toBeNull();
		expect(prevPr(queue, "github:owner/repo#1")).toBeNull();
		expect(nextPr(queue, "missing")?.number).toBe(1);
		expect(prevPr(queue, "missing")).toBeNull();
		expect(nextPr({ needsReview: [], waitingOnAuthor: [] }, "missing")).toBeNull();
	});
	test("reports progress and new commits only from explicit evidence", () => {
		expect(queueStatus({ headCommitSha: "new" })).toEqual({ label: "Not mapped", tone: "muted" });
		expect(queueStatus({ headCommitSha: "new", lastViewedHeadSha: "old" }).label).toBe(
			"New commits"
		);
		expect(queueStatus({ viewed: { viewed: 2, total: 7 } }).label).toBe("2 of 7 viewed");
		expect(queueStatus({ pathStatus: "mapping", viewed: { viewed: 2, total: 7 } }).label).toBe(
			"Mapping"
		);
		expect(queueStatus({ pathStatus: "ready" }).label).toBe("Path ready");
	});
});
