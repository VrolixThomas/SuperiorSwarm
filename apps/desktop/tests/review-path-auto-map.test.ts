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

test("eligible abbreviated Bitbucket heads resolve before full-OID validation and deduplicate concurrent polls", async () => {
	const h = harness();
	const short = { ...pr, provider: "bitbucket" as const, headCommitSha: "a".repeat(12) };
	let lookups = 0;
	let release: ((sha: string) => void) | undefined;
	h.deps.resolveHead = async (captured) => {
		lookups++;
		expect(captured).toMatchObject(short);
		return new Promise((resolve) => {
			release = resolve;
		});
	};
	const identities: unknown[] = [];
	h.deps.start = async (identity) => {
		identities.push(identity);
		return { claimed: true, reviewIncluded: false, reviewQueued: true };
	};
	const map = createAutoMapper(h.deps);
	const first = map(short);
	const second = map({ ...short });
	expect(lookups).toBe(1);
	expect(h.stats().workspaces).toBe(0);
	release?.("a".repeat(40));
	expect(await first).toBe(true);
	expect(await second).toBe(true);
	expect(identities).toEqual([
		{
			workspaceId: "w",
			provider: "bitbucket",
			owner: "o",
			repo: "r",
			prNumber: 1,
			headSha: "a".repeat(40),
		},
	]);
	expect(short.headCommitSha).toBe("a".repeat(12));
});

test.each([undefined, "a".repeat(12), "b".repeat(40), "feature/main"])(
	"unverified abbreviated resolutions fail closed: %s",
	async (resolved) => {
		const h = harness();
		h.deps.resolveHead = async () => resolved;
		expect(
			await createAutoMapper(h.deps)({
				...pr,
				provider: "bitbucket",
				headCommitSha: "a".repeat(12),
			})
		).toBe(false);
		expect(h.stats()).toEqual({ launches: 0, workspaces: 0, ledger: 0 });
	}
);

test("failed lookup may be retried and does not poison concurrent deduplication", async () => {
	const h = harness();
	let attempts = 0;
	h.deps.resolveHead = async () => {
		if (++attempts === 1) throw Error("provider unavailable");
		return "a".repeat(40);
	};
	const map = createAutoMapper(h.deps);
	const short = { ...pr, provider: "bitbucket" as const, headCommitSha: "a".repeat(12) };
	await expect(map(short)).rejects.toThrow("provider unavailable");
	expect(h.stats().workspaces).toBe(0);
	expect(await map(short)).toBe(true);
	expect(attempts).toBe(2);
});

test("full revisions and ineligible requests never perform expansion", async () => {
	const h = harness();
	let lookups = 0;
	h.deps.resolveHead = async () => {
		lookups++;
		return "a".repeat(40);
	};
	const map = createAutoMapper(h.deps);
	await map(pr);
	await map({ ...pr, provider: "bitbucket" });
	for (const patch of [
		{ role: "author" },
		{ state: "closed" },
		{ projectId: "" },
		{ provider: "github" },
		{ headCommitSha: "branch" },
		{ headCommitSha: "" },
	])
		await map({
			...pr,
			provider: "bitbucket",
			headCommitSha: "a".repeat(12),
			...patch,
		} as CachedPR);
	h.deps.getSettings = () => ({ autoMapOnReviewRequest: false, alsoReview: true });
	await map({ ...pr, provider: "bitbucket", headCommitSha: "a".repeat(12) });
	expect(lookups).toBe(0);
});

test("lookup captures repository/project/head identity and does not share results across changed scopes", async () => {
	const h = harness();
	const captures: CachedPR[] = [];
	const releases: Array<() => void> = [];
	const starts: unknown[] = [];
	h.deps.resolveHead = async (captured) => {
		captures.push(captured);
		return new Promise((resolve) =>
			releases.push(() => resolve(captured.headCommitSha.padEnd(40, "a")))
		);
	};
	h.deps.start = async (identity) => {
		starts.push(identity);
		return { claimed: true, reviewIncluded: false };
	};
	const map = createAutoMapper(h.deps);
	const original = { ...pr, provider: "bitbucket" as const, headCommitSha: "a".repeat(12) };
	const operations = [
		map(original),
		map({ ...original, repoName: "other", identifier: "o/other#1" }),
		map({ ...original, projectId: "other-project" }),
		map({ ...original, headCommitSha: "b".repeat(12) }),
	];
	original.repoName = "mutated";
	original.headCommitSha = "c".repeat(12);
	original.projectId = "mutated";
	for (const release of releases) release();
	await Promise.all(operations);
	expect(captures).toHaveLength(4);
	expect(starts[0]).toMatchObject({ repo: "r", headSha: "a".repeat(40) });
	expect(starts[1]).toMatchObject({ repo: "other" });
	expect(starts[3]).toMatchObject({ headSha: "b".repeat(12) + "a".repeat(28) });
	expect(captures[0]?.projectId).toBe("p");
});

test("abbreviated metadata lookup is bounded and late completion cannot start a workspace", async () => {
	const h = harness();
	let finish: ((sha: string) => void) | undefined;
	h.deps.resolveHeadTimeoutMs = 20;
	h.deps.resolveHead = () =>
		new Promise((resolve) => {
			finish = resolve;
		});
	const work = createAutoMapper(h.deps)({
		...pr,
		provider: "bitbucket",
		headCommitSha: "a".repeat(12),
	});
	await expect(work).rejects.toThrow("revision lookup timed out");
	finish?.("a".repeat(40));
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(h.stats()).toEqual({ launches: 0, workspaces: 0, ledger: 0 });
});

test("disabling automatic mapping while revision lookup waits prevents a later launch", async () => {
	const h = harness();
	let finish: ((sha: string) => void) | undefined;
	h.deps.resolveHead = () =>
		new Promise((resolve) => {
			finish = resolve;
		});
	const work = createAutoMapper(h.deps)({
		...pr,
		provider: "bitbucket",
		headCommitSha: "a".repeat(12),
	});
	h.deps.getSettings = () => ({ autoMapOnReviewRequest: false, alsoReview: true });
	finish?.("a".repeat(40));
	expect(await work).toBe(false);
	expect(h.stats().workspaces).toBe(0);
});

test("code-review preference is read again after abbreviated revision lookup", async () => {
	const h = harness();
	let finish: ((sha: string) => void) | undefined;
	const requested: boolean[] = [];
	h.deps.resolveHead = () =>
		new Promise((resolve) => {
			finish = resolve;
		});
	h.deps.start = async (_identity, alsoReview) => {
		requested.push(alsoReview);
		return { claimed: true, reviewIncluded: false };
	};
	const work = createAutoMapper(h.deps)({
		...pr,
		provider: "bitbucket",
		headCommitSha: "a".repeat(12),
	});
	h.deps.getSettings = () => ({ autoMapOnReviewRequest: true, alsoReview: false });
	finish?.("a".repeat(40));
	await work;
	expect(requested).toEqual([false]);
	expect(h.stats().ledger).toBe(0);
});
