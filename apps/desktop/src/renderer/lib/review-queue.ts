import type { BitbucketPullRequest } from "../../main/atlassian/bitbucket";
import type { GitHubPR } from "../../main/github/github";
import type { PRContext } from "../../shared/github-types";
import type { ReviewPathStatus } from "../../shared/review-path-types";
import type { CachedPR } from "../../shared/review-types";

export interface ReviewQueuePR {
	key: string;
	provider: PRContext["provider"];
	owner: string;
	repo: string;
	number: number;
	title: string;
	sourceBranch: string;
	targetBranch?: string;
	projectId?: string;
	headCommitSha?: string;
	author?: string;
	updatedAt?: string;
	fileCount?: number;
	isDraft?: boolean;
}
export interface ReviewQueue {
	needsReview: ReviewQueuePR[];
	waitingOnAuthor: ReviewQueuePR[];
}
export function reviewQueueKey(pr: Pick<PRContext, "provider" | "owner" | "repo" | "number">) {
	return `${pr.provider}:${pr.owner}/${pr.repo}#${pr.number}`;
}

/** Preserve provider order, then append cached-only requests. Never resurrect an excluded PR. */
export function buildReviewQueue(input: {
	github?: readonly GitHubPR[];
	bitbucket?: readonly BitbucketPullRequest[];
	cached?: readonly CachedPR[];
}): ReviewQueue {
	const queue: ReviewQueue = { needsReview: [], waitingOnAuthor: [] };
	const seen = new Set<string>();
	const cache = new Map<string, CachedPR>();
	const authored = new Set<string>();
	for (const pr of input.cached ?? []) {
		const key = reviewQueueKey({
			provider: pr.provider,
			owner: pr.repoOwner,
			repo: pr.repoName,
			number: pr.number,
		});
		cache.set(key, pr);
		if (pr.role === "author") authored.add(key);
	}
	for (const pr of input.github ?? []) {
		if (pr.role === "author")
			authored.add(
				reviewQueueKey({
					provider: "github",
					owner: pr.repoOwner,
					repo: pr.repoName,
					number: pr.number,
				})
			);
	}
	function add(pr: Omit<ReviewQueuePR, "key">, eligible: boolean, waiting = false) {
		const key = reviewQueueKey(pr);
		if (seen.has(key)) return;
		seen.add(key);
		if (!eligible || authored.has(key)) return;
		const cached = cache.get(key);
		const item: ReviewQueuePR = {
			...pr,
			key,
			targetBranch: pr.targetBranch ?? cached?.targetBranch,
			projectId: pr.projectId ?? cached?.projectId,
			headCommitSha: pr.headCommitSha ?? cached?.headCommitSha,
			author: pr.author ?? cached?.author?.login,
			updatedAt: pr.updatedAt ?? cached?.updatedAt,
			fileCount: pr.fileCount ?? cached?.changedFiles,
		};
		queue[waiting ? "waitingOnAuthor" : "needsReview"].push(item);
	}
	for (const pr of input.github ?? []) {
		add(
			{
				provider: "github",
				owner: pr.repoOwner,
				repo: pr.repoName,
				number: pr.number,
				title: pr.title,
				sourceBranch: pr.branchName,
				isDraft: pr.isDraft,
			},
			pr.role === "reviewer" && pr.state === "open",
			pr.isDraft || pr.reviewDecision === "changes_requested"
		);
	}
	for (const pr of input.bitbucket ?? []) {
		add(
			{
				provider: "bitbucket",
				owner: pr.workspace,
				repo: pr.repoSlug,
				number: pr.id,
				title: pr.title,
				sourceBranch: pr.source?.branch?.name ?? "",
				targetBranch: pr.destination?.branch?.name,
				headCommitSha: pr.headCommitSha,
				author: pr.author,
				updatedAt: pr.updatedOn,
			},
			pr.state.toLowerCase() === "open"
		);
	}
	for (const pr of input.cached ?? []) {
		add(
			{
				provider: pr.provider,
				owner: pr.repoOwner,
				repo: pr.repoName,
				number: pr.number,
				title: pr.title,
				sourceBranch: pr.sourceBranch,
				targetBranch: pr.targetBranch,
				projectId: pr.projectId,
				headCommitSha: pr.headCommitSha,
			},
			pr.role === "reviewer" && pr.state === "open"
		);
	}
	return queue;
}

export function nextPr(queue: ReviewQueue, currentKey: string): ReviewQueuePR | null {
	const index = queue.needsReview.findIndex((pr) => pr.key === currentKey);
	return queue.needsReview[index + 1] ?? null;
}
export function prevPr(queue: ReviewQueue, currentKey: string): ReviewQueuePR | null {
	const index = queue.needsReview.findIndex((pr) => pr.key === currentKey);
	return index > 0 ? (queue.needsReview[index - 1] ?? null) : null;
}

export interface ReviewQueueFacts {
	changedFiles?: number;
	pathStatus?: ReviewPathStatus;
	headCommitSha?: string;
	/** Only supply a revision explicitly associated with the user's viewed state. */
	lastViewedHeadSha?: string;
	viewed?: { viewed: number; total: number };
}
export function queueStatus(facts: ReviewQueueFacts): {
	label: string;
	tone: "muted" | "accent" | "warning";
} {
	if (facts.pathStatus === "mapping") return { label: "Mapping", tone: "accent" };
	if (
		facts.headCommitSha &&
		facts.lastViewedHeadSha &&
		facts.headCommitSha !== facts.lastViewedHeadSha
	)
		return { label: "New commits", tone: "warning" };
	if (facts.viewed)
		return { label: `${facts.viewed.viewed} of ${facts.viewed.total} viewed`, tone: "muted" };
	if (facts.pathStatus === "ready") return { label: "Path ready", tone: "muted" };
	if (facts.pathStatus === "stale") return { label: "Path outdated", tone: "warning" };
	if (facts.pathStatus === "failed") return { label: "Mapping unavailable", tone: "muted" };
	return {
		label: facts.pathStatus === "none" ? "Not mapped" : "Status unavailable",
		tone: "muted",
	};
}
