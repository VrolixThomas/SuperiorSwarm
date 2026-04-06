# Bitbucket PR Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reviewer avatars, CI status, and review decision to Bitbucket PRs in the sidebar, matching the GitHub enrichment experience.

**Architecture:** Add `getPRListEnrichment()` to `BitbucketAdapter` that fetches participants and build statuses from the Bitbucket API, returning data in the same `GitHubPREnriched` shape. Expose via a tRPC procedure on the Atlassian router. Wire the renderer to query both GitHub and Bitbucket enrichment and merge into a single map for `RichPRItem`.

**Tech Stack:** TypeScript, Electron, tRPC, React, Bitbucket 2.0 REST API, Bun test runner

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/desktop/src/main/providers/bitbucket-adapter.ts` | Modify | Add `getPRListEnrichment()` method |
| `apps/desktop/tests/bitbucket-enrichment.test.ts` | Create | Tests for participant/status mapping logic |
| `apps/desktop/src/main/trpc/routers/atlassian.ts` | Modify | Add `getPRListEnrichment` tRPC procedure |
| `apps/desktop/src/renderer/components/PullRequestsTab.tsx` | Modify | Add Bitbucket enrichment query + merge maps |

---

### Task 1: Add enrichment mapping logic with tests

Pure functions that map Bitbucket API responses to `GitHubPREnriched` shape. Test these in isolation.

**Files:**
- Test: `apps/desktop/tests/bitbucket-enrichment.test.ts`
- Modify: `apps/desktop/src/main/providers/bitbucket-adapter.ts`

- [ ] **Step 1: Write tests for participant-to-reviewer mapping**

```typescript
// apps/desktop/tests/bitbucket-enrichment.test.ts
import { describe, expect, test } from "bun:test";
import {
	aggregateCIState,
	deriveReviewDecision,
	mapParticipantToReviewer,
} from "../src/main/providers/bitbucket-adapter";

describe("Bitbucket enrichment mapping", () => {
	describe("mapParticipantToReviewer", () => {
		test("maps approved reviewer", () => {
			const participant = {
				user: { display_name: "Alice" },
				role: "REVIEWER",
				state: "approved",
			};
			const result = mapParticipantToReviewer(participant);
			expect(result).toEqual({
				login: "Alice",
				avatarUrl: "",
				decision: "APPROVED",
			});
		});

		test("maps changes_requested reviewer", () => {
			const participant = {
				user: { display_name: "Bob" },
				role: "REVIEWER",
				state: "changes_requested",
			};
			const result = mapParticipantToReviewer(participant);
			expect(result.decision).toBe("CHANGES_REQUESTED");
		});

		test("maps pending reviewer (no state)", () => {
			const participant = {
				user: { display_name: "Carol" },
				role: "REVIEWER",
				state: null,
			};
			const result = mapParticipantToReviewer(participant);
			expect(result.decision).toBe("PENDING");
		});

		test("handles null user", () => {
			const participant = {
				user: null,
				role: "REVIEWER",
				state: "approved",
			};
			const result = mapParticipantToReviewer(participant);
			expect(result.login).toBe("Unknown");
		});
	});

	describe("aggregateCIState", () => {
		test("returns SUCCESS when all successful", () => {
			const statuses = [{ state: "SUCCESSFUL" }, { state: "SUCCESSFUL" }];
			expect(aggregateCIState(statuses)).toBe("SUCCESS");
		});

		test("returns FAILURE when any failed", () => {
			const statuses = [{ state: "SUCCESSFUL" }, { state: "FAILED" }];
			expect(aggregateCIState(statuses)).toBe("FAILURE");
		});

		test("returns PENDING when any in progress", () => {
			const statuses = [{ state: "SUCCESSFUL" }, { state: "INPROGRESS" }];
			expect(aggregateCIState(statuses)).toBe("PENDING");
		});

		test("returns null for empty statuses", () => {
			expect(aggregateCIState([])).toBeNull();
		});

		test("FAILURE takes precedence over INPROGRESS", () => {
			const statuses = [{ state: "FAILED" }, { state: "INPROGRESS" }];
			expect(aggregateCIState(statuses)).toBe("FAILURE");
		});
	});

	describe("deriveReviewDecision", () => {
		test("returns APPROVED when any approved and none requesting changes", () => {
			const reviewers = [
				{ login: "A", avatarUrl: "", decision: "APPROVED" as const },
				{ login: "B", avatarUrl: "", decision: "PENDING" as const },
			];
			expect(deriveReviewDecision(reviewers)).toBe("APPROVED");
		});

		test("returns CHANGES_REQUESTED when any requesting changes", () => {
			const reviewers = [
				{ login: "A", avatarUrl: "", decision: "APPROVED" as const },
				{ login: "B", avatarUrl: "", decision: "CHANGES_REQUESTED" as const },
			];
			expect(deriveReviewDecision(reviewers)).toBe("CHANGES_REQUESTED");
		});

		test("returns REVIEW_REQUIRED when all pending", () => {
			const reviewers = [
				{ login: "A", avatarUrl: "", decision: "PENDING" as const },
			];
			expect(deriveReviewDecision(reviewers)).toBe("REVIEW_REQUIRED");
		});

		test("returns REVIEW_REQUIRED for empty reviewers", () => {
			expect(deriveReviewDecision([])).toBe("REVIEW_REQUIRED");
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail (functions don't exist yet)**

Run: `cd apps/desktop && bun test tests/bitbucket-enrichment.test.ts`
Expected: FAIL (imports not found)

- [ ] **Step 3: Implement the mapping functions**

Add these exported pure functions to `apps/desktop/src/main/providers/bitbucket-adapter.ts`, before the `BitbucketAdapter` class:

```typescript
// ── Enrichment mapping helpers (exported for testing) ─────────────────────────

interface BitbucketParticipant {
	user?: { display_name?: string } | null;
	role: string;
	state?: string | null;
}

interface BitbucketStatus {
	state: string;
}

export function mapParticipantToReviewer(
	p: BitbucketParticipant
): GitHubReviewer {
	let decision: GitHubReviewer["decision"];
	switch (p.state) {
		case "approved":
			decision = "APPROVED";
			break;
		case "changes_requested":
			decision = "CHANGES_REQUESTED";
			break;
		default:
			decision = "PENDING";
	}
	return {
		login: p.user?.display_name ?? "Unknown",
		avatarUrl: "",
		decision,
	};
}

export function aggregateCIState(
	statuses: BitbucketStatus[]
): "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL" | null {
	if (statuses.length === 0) return null;
	if (statuses.some((s) => s.state === "FAILED" || s.state === "STOPPED")) return "FAILURE";
	if (statuses.some((s) => s.state === "INPROGRESS")) return "PENDING";
	if (statuses.every((s) => s.state === "SUCCESSFUL")) return "SUCCESS";
	return null;
}

export function deriveReviewDecision(
	reviewers: GitHubReviewer[]
): "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null {
	if (reviewers.length === 0) return "REVIEW_REQUIRED";
	if (reviewers.some((r) => r.decision === "CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
	if (reviewers.some((r) => r.decision === "APPROVED")) return "APPROVED";
	return "REVIEW_REQUIRED";
}
```

Also add an import at the top of `bitbucket-adapter.ts`:

```typescript
import type { GitHubPREnriched, GitHubReviewer } from "../../shared/github-types";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/bitbucket-enrichment.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/providers/bitbucket-adapter.ts apps/desktop/tests/bitbucket-enrichment.test.ts
git commit -m "feat: add Bitbucket enrichment mapping helpers with tests"
```

---

### Task 2: Add `getPRListEnrichment()` to BitbucketAdapter

Fetches PR details (for participants) and build statuses for each PR, maps to `GitHubPREnriched`.

**Files:**
- Modify: `apps/desktop/src/main/providers/bitbucket-adapter.ts`

- [ ] **Step 1: Add the enrichment method to the BitbucketAdapter class**

Add this method to the `BitbucketAdapter` class, after `getReviewThreads()`:

```typescript
	// ── Bitbucket-specific extras ─────────────────────────────────────────────

	async getPRListEnrichment(
		prs: Array<{ workspace: string; repoSlug: string; prId: number }>
	): Promise<GitHubPREnriched[]> {
		const results: GitHubPREnriched[] = [];

		const settled = await Promise.allSettled(
			prs.map(async ({ workspace, repoSlug, prId }) => {
				// Fetch PR details (for participants) and statuses in parallel
				const [prRes, statusRes] = await Promise.all([
					atlassianFetch(
						"bitbucket",
						`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`
					),
					atlassianFetch(
						"bitbucket",
						`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/statuses?pagelen=100`
					),
				]);

				// Parse PR for participants
				const prData = prRes.ok
					? ((await prRes.json()) as {
							author?: { display_name?: string } | null;
							participants?: BitbucketParticipant[];
							updated_on?: string;
						})
					: null;

				// Parse statuses
				const statusData = statusRes.ok
					? ((await statusRes.json()) as {
							values?: BitbucketStatus[];
						})
					: null;

				const reviewerParticipants = (prData?.participants ?? []).filter(
					(p) => p.role === "REVIEWER"
				);
				const reviewers = reviewerParticipants.map(mapParticipantToReviewer);
				const ciState = aggregateCIState(statusData?.values ?? []);
				const reviewDecision = deriveReviewDecision(reviewers);

				return {
					owner: workspace,
					repo: repoSlug,
					number: prId,
					author: prData?.author?.display_name ?? "Unknown",
					authorAvatarUrl: "",
					reviewers,
					ciState,
					reviewDecision,
					unresolvedThreadCount: 0,
					files: { additions: 0, deletions: 0, count: 0 },
					headCommitOid: "",
					mergeable: "UNKNOWN" as const,
					isDraft: false,
					updatedAt: prData?.updated_on ?? "",
				} satisfies GitHubPREnriched;
			})
		);

		for (const result of settled) {
			if (result.status === "fulfilled") {
				results.push(result.value);
			}
		}

		return results;
	}
```

Make sure `BitbucketParticipant` and `BitbucketStatus` interfaces (from Task 1) are accessible to this method — they should be defined at module level above the class.

- [ ] **Step 2: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 3: Run tests**

Run: `cd apps/desktop && bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/providers/bitbucket-adapter.ts
git commit -m "feat: add getPRListEnrichment() to BitbucketAdapter

Fetches PR participants and build statuses from Bitbucket API,
maps to GitHubPREnriched shape for sidebar display."
```

---

### Task 3: Add tRPC procedure to Atlassian router

Expose the enrichment method as a tRPC query.

**Files:**
- Modify: `apps/desktop/src/main/trpc/routers/atlassian.ts`

- [ ] **Step 1: Add import for BitbucketAdapter**

At the top of `apps/desktop/src/main/trpc/routers/atlassian.ts`, add:

```typescript
import { getGitProvider } from "../../providers/git-provider";
import { BitbucketAdapter } from "../../providers/bitbucket-adapter";
```

- [ ] **Step 2: Add the procedure**

Add this procedure inside the router, before the closing `});`:

```typescript
	getPRListEnrichment: publicProcedure
		.input(
			z.object({
				prs: z.array(
					z.object({
						workspace: z.string(),
						repoSlug: z.string(),
						prId: z.number(),
					})
				),
			})
		)
		.query(async ({ input }) => {
			const provider = getGitProvider("bitbucket");
			if (!provider.isConnected()) return [];
			const adapter = provider as BitbucketAdapter;
			return adapter.getPRListEnrichment(input.prs);
		}),
```

- [ ] **Step 3: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/trpc/routers/atlassian.ts
git commit -m "feat: add getPRListEnrichment tRPC procedure for Bitbucket"
```

---

### Task 4: Wire renderer to Bitbucket enrichment

Add a second enrichment query, merge both maps, and fix the provider checks.

**Files:**
- Modify: `apps/desktop/src/renderer/components/PullRequestsTab.tsx`

- [ ] **Step 1: Read the current file to find exact insertion points**

Read `apps/desktop/src/renderer/components/PullRequestsTab.tsx` fully, noting exact line numbers for:
- `reviewerPRsForEnrichment` memo (~line 352)
- `enrichmentQuery` (~line 361)
- `enrichmentMap` memo (~line 370)
- The render loop's `isReviewer` / `enrichmentKey` / `enriched` logic (~line 864)

- [ ] **Step 2: Add Bitbucket enrichment PR list memo**

After the `reviewerPRsForEnrichment` memo, add:

```typescript
const bitbucketPRsForEnrichment = useMemo(() => {
	const prs: Array<{ workspace: string; repoSlug: string; prId: number }> = [];
	for (const pr of bbReviewPRs ?? []) {
		prs.push({ workspace: pr.workspace, repoSlug: pr.repoSlug, prId: pr.id });
	}
	return prs;
}, [bbReviewPRs]);
```

Note: `bbReviewPRs` is the result of `trpc.atlassian.getReviewRequests.useQuery()` — check the exact variable name in the file.

- [ ] **Step 3: Add Bitbucket enrichment query**

After the GitHub `enrichmentQuery`, add:

```typescript
const bbEnrichmentQuery = trpc.atlassian.getPRListEnrichment.useQuery(
	{ prs: bitbucketPRsForEnrichment },
	{
		enabled: bitbucketPRsForEnrichment.length > 0,
		staleTime: 30_000,
		refetchInterval: 60_000,
	}
);
```

- [ ] **Step 4: Merge enrichment maps**

Replace the `enrichmentMap` memo to include both sources:

```typescript
const enrichmentMap = useMemo(() => {
	const map = new Map<string, GitHubPREnriched>();
	for (const pr of enrichmentQuery.data ?? []) {
		map.set(`${pr.owner}/${pr.repo}#${pr.number}`, pr);
	}
	for (const pr of bbEnrichmentQuery.data ?? []) {
		map.set(`${pr.owner}/${pr.repo}#${pr.number}`, pr);
	}
	return map;
}, [enrichmentQuery.data, bbEnrichmentQuery.data]);
```

- [ ] **Step 5: Fix the render loop enrichment logic**

Update the `isReviewer` / `enrichmentKey` / `enrichmentLoading` section to handle Bitbucket:

```typescript
const isReviewer =
	pr.githubPR?.role === "reviewer" ||
	pr.provider === "bitbucket"; // Bitbucket review PRs are from getReviewRequests()

const enrichmentKey =
	pr.githubPR
		? `${pr.githubPR.repoOwner}/${pr.githubPR.repoName}#${pr.githubPR.number}`
		: pr.bitbucketPR
			? `${pr.bitbucketPR.workspace}/${pr.bitbucketPR.repoSlug}#${pr.bitbucketPR.id}`
			: undefined;

const enriched =
	isReviewer && enrichmentKey ? enrichmentMap.get(enrichmentKey) : undefined;

const enrichmentLoading =
	isReviewer &&
	((reviewerPRsForEnrichment.length > 0 && enrichmentQuery.isLoading) ||
		(bitbucketPRsForEnrichment.length > 0 && bbEnrichmentQuery.isLoading));
```

- [ ] **Step 6: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `cd apps/desktop && bun test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "feat: wire Bitbucket PR enrichment to sidebar UI

Adds second enrichment query for Bitbucket reviewer PRs, merges
both GitHub and Bitbucket enrichment into a single map. Bitbucket
PRs now show reviewer avatars, CI status, and review decision."
```

---

### Task 5: Lint and final verification

**Files:**
- All modified files

- [ ] **Step 1: Run biome check**

Run: `bun run check`
Expected: No new errors from our changes.

- [ ] **Step 2: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd apps/desktop && bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "chore: fix lint issues from Bitbucket enrichment changes"
```
