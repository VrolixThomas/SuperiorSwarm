import { expect, test } from "bun:test";
import { type AutoMapDeps, createAutoMapper } from "../src/main/review-path/auto-map";
import type { CachedPR } from "../src/shared/review-types";
const pr: CachedPR = {
	provider: "github",
	identifier: "o/r#1",
	repoOwner: "o",
	repoName: "r",
	number: 1,
	headCommitSha: "a".repeat(40),
	projectId: "p",
	role: "reviewer",
	state: "open",
	title: "PR",
	sourceBranch: "feature",
	targetBranch: "main",
	author: { login: "a", avatarUrl: "" },
	reviewers: [],
	ciStatus: null,
	commentCount: 0,
	changedFiles: 1,
	additions: 1,
	deletions: 0,
	updatedAt: "now",
};
function harness() {
	const claims = new Set<string>();
	let launches = 0;
	let workspaces = 0;
	let ledger = 0;
	const deps: AutoMapDeps = {
		getSettings: () => ({ autoMapOnReviewRequest: true, alsoReview: true }),
		hasReview: () => false,
		wasReviewed: () => false,
		ensureWorkspace: async () => {
			workspaces++;
			return "w";
		},
		start: async (identity, alsoReview) => {
			const key = identity.headSha;
			const duplicate = claims.has(key);
			claims.add(key);
			if (!duplicate) launches++;
			return { claimed: !duplicate, reviewIncluded: alsoReview };
		},
		markReviewed: () => {
			ledger++;
		},
	};
	return { deps, stats: () => ({ launches, workspaces, ledger }) };
}
test("concurrent polling requests and restart use one durable map claim", async () => {
	const h = harness();
	const map = createAutoMapper(h.deps);
	await Promise.all([map(pr), map(pr)]);
	expect(h.stats().launches).toBe(1);
	await createAutoMapper(h.deps)(pr);
	expect(h.stats().launches).toBe(1);
});
test("authored, closed, unsupported, unlinked, and unknown heads never launch", async () => {
	const h = harness();
	const map = createAutoMapper(h.deps);
	for (const patch of [
		{ role: "author" },
		{ state: "closed" },
		{ projectId: "" },
		{ provider: "gitlab" },
		{ headCommitSha: "" },
	])
		await map({ ...pr, ...patch } as CachedPR);
	expect(h.stats()).toEqual({ launches: 0, workspaces: 0, ledger: 0 });
});
test("mapping plus review claims existing auto-review ledger only after success", async () => {
	const h = harness();
	expect(await createAutoMapper(h.deps)(pr)).toBe(true);
	expect(h.stats().ledger).toBe(1);
});
test("existing review disables additional findings but still maps", async () => {
	const h = harness();
	h.deps.hasReview = () => true;
	const requested: boolean[] = [];
	h.deps.start = async (_id, alsoReview) => {
		requested.push(alsoReview);
		return { claimed: true, reviewIncluded: false };
	};
	expect(await createAutoMapper(h.deps)(pr)).toBe(false);
	expect(requested).toEqual([false]);
	expect(h.stats().ledger).toBe(0);
});

test("an old map-only claim never marks a code review as performed", async () => {
	const h = harness();
	h.deps.start = async () => ({ claimed: false, reviewIncluded: false });
	expect(await createAutoMapper(h.deps)(pr)).toBe(false);
	expect(h.stats().ledger).toBe(0);
});

test("durably queued preparation suppresses the legacy launcher without claiming a performed review", async () => {
	const h = harness();
	h.deps.start = async () => ({ claimed: true, reviewIncluded: false, reviewQueued: true });
	expect(await createAutoMapper(h.deps)(pr)).toBe(true);
	expect(h.stats().ledger).toBe(0);
});
