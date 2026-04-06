# Bitbucket PR Enrichment Design

**Date:** 2026-04-06
**Branch:** `refactor/provider-interfaces`
**Linear:** SUP-16
**Status:** Approved

## Problem

Bitbucket PRs in the sidebar show only minimal info (title, branches). GitHub PRs show reviewer avatars with verdicts, CI status color, and file stats via an enrichment query. The Bitbucket API supports all of this but we're not fetching it.

## Solution

Add a Bitbucket PR enrichment path that mirrors GitHub's: a provider-specific `getPRListEnrichment()` method on `BitbucketAdapter`, a tRPC procedure on the Atlassian router, and renderer changes to merge both enrichment sources into a single map for `RichPRItem`.

## Scope

**In scope:**
- `BitbucketAdapter.getPRListEnrichment()` — fetches participants + build statuses
- `atlassian.getPRListEnrichment` tRPC procedure
- Renderer: second enrichment query for Bitbucket, merged enrichment map, fix `isReviewer` check

**Out of scope:**
- Bitbucket avatar URLs (not available from PR participant endpoint without extra user API calls)
- Mergeable state (Bitbucket doesn't expose this simply)
- Unresolved thread count (would require fetching all comments)
- File stats in enrichment (already available via diffstat but not worth the extra API call for sidebar display)

---

## Backend

### BitbucketAdapter.getPRListEnrichment()

New provider-specific method (not on the `GitProvider` interface):

```typescript
async getPRListEnrichment(
  prs: Array<{ workspace: string; repoSlug: string; prId: number }>
): Promise<GitHubPREnriched[]>
```

For each PR, makes two parallel API calls:
1. **PR details** — `GET /repositories/{workspace}/{repoSlug}/pullrequests/{prId}` (re-fetch to get `participants` array)
2. **Build statuses** — `GET /repositories/{workspace}/{repoSlug}/pullrequests/{prId}/statuses`

Uses `Promise.allSettled` so one failing PR doesn't block the rest.

### Participant → Reviewer mapping

Bitbucket `participants` array:
```json
{
  "user": { "display_name": "Alice", "account_id": "..." },
  "role": "REVIEWER",
  "state": "approved",
  "approved": true
}
```

Maps to `GitHubReviewer`:
- `login` ← `user.display_name ?? "Unknown"`
- `avatarUrl` ← `""` (not available without extra API call)
- `decision`:
  - `"approved"` → `"APPROVED"`
  - `"changes_requested"` → `"CHANGES_REQUESTED"`
  - else → `"PENDING"`

### CI status aggregation

Bitbucket statuses have `state`: SUCCESSFUL, FAILED, INPROGRESS, STOPPED.

Aggregate to `ciState`:
- Any FAILED → `"FAILURE"`
- All SUCCESSFUL → `"SUCCESS"`
- Any INPROGRESS → `"PENDING"`
- else → `null`

### Review decision derivation

Derived from reviewer states:
- Any reviewer has `"changes_requested"` → `"CHANGES_REQUESTED"`
- Any reviewer has `"approved"` and none have `"changes_requested"` → `"APPROVED"`
- else → `"REVIEW_REQUIRED"`

### Fields set to defaults

- `mergeable` → `"UNKNOWN"`
- `unresolvedThreadCount` → `0`
- `files` → `{ additions: 0, deletions: 0, count: 0 }`
- `isDraft` → `false`
- `authorAvatarUrl` → `""`

---

## tRPC Router

New procedure on `atlassianRouter`:

```typescript
getPRListEnrichment: publicProcedure
  .input(z.object({
    prs: z.array(z.object({
      workspace: z.string(),
      repoSlug: z.string(),
      prId: z.number(),
    })),
  }))
  .query(async ({ input }) => { ... })
```

Returns `GitHubPREnriched[]`. Only fetches for connected Bitbucket users (returns `[]` if not connected).

---

## Renderer

Changes in `PullRequestsTab.tsx`:

### 1. Second enrichment query

Add `trpc.atlassian.getPRListEnrichment` query for Bitbucket reviewer PRs. Same config as GitHub:
- `enabled`: only when Bitbucket reviewer PRs exist
- `staleTime: 30_000`
- `refetchInterval: 60_000`

### 2. Merged enrichment map

Build a single `Map<string, GitHubPREnriched>` from both GitHub and Bitbucket enrichment results. Key format: `${owner}/${repo}#${number}`.

### 3. Fix isReviewer check

Current: `pr.githubPR?.role === "reviewer"` — always false for Bitbucket.

Change to also detect Bitbucket reviewer PRs. Bitbucket PRs from `getReviewRequests()` are already implicitly reviewer PRs.

### 4. Fix enrichment key for Bitbucket

Build key from `workspace/repoSlug#prId` so it matches the enrichment map.

No changes to `RichPRItem` itself — it already renders based on the `enriched` prop being present or absent.
