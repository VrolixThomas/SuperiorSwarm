# Provider Interface Abstraction Design

**Date:** 2026-04-06
**Branch:** `refactor/provider-interfaces`
**Status:** Approved

## Problem

When a new user connects to Bitbucket (or GitHub) with existing branches that already have PRs and comments, the app crashes. The root cause is twofold:

1. **No null safety on API responses.** Provider API functions cast raw JSON to TypeScript interfaces and assume every field is present. Deleted users (null `author`), system comments (null `content`), and edge-case PR states (null `source.commit`) cause TypeErrors that crash the main process.

2. **Scattered provider logic.** Consumer code (pollers, publishers, orchestrator) contains `if (provider === "github") ... else ...` branches, each with its own null-safety gaps. Fixing null safety in every branch independently is error-prone and unmaintainable.

Additionally, Bitbucket's `resolvePRComment()` uses the wrong API endpoint (PUT with `resolved` field instead of POST/DELETE on `/resolve` sub-resource).

## Solution

Introduce a **provider interface + adapter pattern**:

- Define `GitProvider` and `IssueTracker` TypeScript interfaces with shared operations
- Implement adapters (`GitHubAdapter`, `BitbucketAdapter`, `JiraAdapter`, `LinearAdapter`) that wrap existing API functions and enforce null safety at the boundary
- Replace provider switches in consumers with registry lookups
- Fix broken Bitbucket comment resolution
- Add global error handlers as a safety net

## Scope

**In scope:**
- Interfaces + normalized types
- 4 adapters wrapping existing API code
- Registry for provider lookup
- Consumer migration (pollers, publishers, routers)
- Fix broken Bitbucket `resolvePRComment` endpoint
- Global error handlers (`unhandledRejection`, `uncaughtException`)
- Null safety enforced at the adapter boundary

**Out of scope (follow-up Linear tickets):**
- Bitbucket diffstat endpoint (file change tracking with rename detection)
- Bitbucket review verdicts (approve/request-changes)
- Bitbucket PR enrichment (reviewers, CI status)

---

## Interfaces

### GitProvider

```typescript
interface GitProvider {
  readonly name: "github" | "bitbucket";

  // Auth
  isConnected(): boolean;

  // PRs
  getMyPRs(): Promise<NormalizedPR[]>;
  getPRState(owner: string, repo: string, prNumber: number): Promise<PRState>;

  // Comments
  getPRComments(owner: string, repo: string, prNumber: number): Promise<NormalizedComment[]>;
  createInlineComment(params: CreateCommentParams): Promise<{ id: string }>;
  replyToComment(params: ReplyParams): Promise<{ id: string }>;
  resolveComment(params: ResolveParams): Promise<void>;
  unresolveComment(params: ResolveParams): Promise<void>;
}
```

### IssueTracker

```typescript
interface IssueTracker {
  readonly name: "jira" | "linear";

  // Auth
  isConnected(): boolean;

  // Issues
  getAssignedIssues(options?: { includeDone?: boolean }): Promise<NormalizedIssue[]>;
  getIssueDetail(issueId: string): Promise<NormalizedIssueDetail>;
  getAvailableStates(context: { issueId?: string; teamId?: string }): Promise<NormalizedState[]>;
  updateIssueState(issueId: string, stateId: string): Promise<void>;
}
```

### Provider-Specific Extras

GitHub-only features (`getPRDetails`, `submitReview`, `getPRFiles`, `getReviewThreads`) remain accessible by narrowing:

```typescript
const git = getGitProvider("github");
if (git instanceof GitHubAdapter) {
  const details = await git.getPRDetails(owner, repo, number);
}
```

---

## Normalized Types

All fields are guaranteed non-null (except explicitly nullable ones). Adapters enforce this with `?.` and `??` fallbacks.

```typescript
interface NormalizedPR {
  id: number;
  title: string;
  state: "open" | "closed" | "merged" | "declined";
  author: string;          // fallback: "Unknown"
  webUrl: string;          // fallback: ""
  sourceBranch: string;    // fallback: ""
  targetBranch: string;    // fallback: ""
  role: "author" | "reviewer";
}

interface PRState {
  headSha: string;         // fallback: ""
  state: "open" | "closed" | "merged" | "declined";
}

interface NormalizedComment {
  id: string;              // always string (both providers use numbers, normalized to string)
  body: string;            // fallback: ""
  author: string;          // fallback: "Unknown"
  filePath: string | null;
  lineNumber: number | null;
  createdAt: string;
}

interface NormalizedIssue {
  id: string;
  identifier: string;     // e.g. "PROJ-123" or "SUP-45"
  title: string;
  url: string;
  status: string;
  statusCategory: string;  // e.g. "done", "in_progress", "todo"
  statusColor: string;     // hex color
}

interface NormalizedIssueDetail {
  description: string;     // fallback: ""
  comments: Array<{
    id: string;
    author: string;        // fallback: "Unknown"
    avatarUrl?: string;
    body: string;          // fallback: ""
    createdAt: string;
  }>;
}

interface NormalizedState {
  id: string;
  name: string;
}

interface CreateCommentParams {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  filePath?: string;
  line?: number;
}

interface ReplyParams {
  owner: string;
  repo: string;
  prNumber: number;
  commentId: string;       // parent comment or thread ID
  body: string;
}

interface ResolveParams {
  owner: string;
  repo: string;
  prNumber: number;
  commentId: string;
}
```

---

## File Structure

```
src/main/providers/
  types.ts              # All interfaces + normalized types
  git-provider.ts       # GitProvider interface + registry (getGitProvider)
  issue-tracker.ts      # IssueTracker interface + registry (getIssueTracker)
  github-adapter.ts     # GitHubAdapter implements GitProvider
  bitbucket-adapter.ts  # BitbucketAdapter implements GitProvider
  jira-adapter.ts       # JiraAdapter implements IssueTracker
  linear-adapter.ts     # LinearAdapter implements IssueTracker
```

Existing files (`atlassian/bitbucket.ts`, `github/github.ts`, `atlassian/jira.ts`, `linear/linear.ts`) stay unchanged. Adapters wrap them.

---

## Registry

```typescript
const gitProviders = new Map<string, GitProvider>();

export function registerGitProvider(provider: GitProvider): void {
  gitProviders.set(provider.name, provider);
}

export function getGitProvider(name: string): GitProvider {
  const provider = gitProviders.get(name);
  if (!provider) throw new Error(`Unknown git provider: ${name}`);
  return provider;
}
```

Same pattern for `registerIssueTracker` / `getIssueTracker`.

Providers are registered at app startup in `index.ts`.

---

## Null Safety Strategy

Adapters are the trust boundary. Raw API responses are untrusted; normalized types are guaranteed safe.

Each adapter:
1. **Types raw responses loosely** — all fields optional/nullable
2. **Coalesces at mapping time** — `?.` and `??` with sensible fallbacks
3. **Returns normalized types** — consumers never see raw API shapes

Example:
```typescript
// In BitbucketAdapter.getPRComments()
for (const c of data.values ?? []) {
  comments.push({
    id: String(c.id ?? 0),
    body: c.content?.raw ?? "",
    author: c.author?.display_name ?? "Unknown",
    filePath: c.inline?.path ?? null,
    lineNumber: c.inline?.to ?? null,
    createdAt: c.created_on ?? "",
  });
}
```

---

## Consumer Migration

| Consumer | Change |
|----------|--------|
| `pr-poller.ts` | Replace separate GitHub/Bitbucket fetch + mapping with `getGitProvider(name).getMyPRs()` |
| `comment-poller.ts` | Replace `fetchGitHubComments`/`fetchBitbucketComments` + if/else with `getGitProvider(prProvider).getPRComments()` |
| `commit-poller.ts` | Replace provider branch for `getPRState` with `getGitProvider(chain.prProvider).getPRState()` |
| `review-publisher.ts` | Shared inline comment posting through interface; GitHub-specific thread/verdict stays as narrowed call |
| `solve-publisher.ts` | Use `resolveComment()` through interface for both providers (enables Bitbucket resolution) |
| `tickets.ts` router | Replace separate Jira/Linear calls with `getIssueTracker(name).getAssignedIssues()` |
| `index.ts` | Register adapters at startup, add `isDestroyed()` checks, wrap async handlers in try/catch |

Provider-specific tRPC routers (`github.ts`, `atlassian.ts`, `linear.ts`) keep importing raw functions for provider-specific features exposed to the renderer.

**Note on `CachedPR`:** The existing `CachedPR` type in `pr-poller.ts` adds `provider`, `projectId`, and `identifier` on top of PR data. After the refactor, `CachedPR` wraps `NormalizedPR` with these extra fields rather than duplicating PR fields. The poller calls `getMyPRs()` → gets `NormalizedPR[]` → enriches each with provider/project metadata → stores as `CachedPR`.

**Note on `getAvailableStates`:** Jira's transitions are issue-specific (`getIssueTransitions(issueKey)`), while Linear's states are team-specific (`getTeamStates(teamId)`). The interface accepts `{ issueId?, teamId? }` — each adapter uses whichever field it needs.

---

## Bitbucket Resolution Fix

Current `resolvePRComment()` is broken — uses PUT with `{ resolved: true }`.

Fixed in `BitbucketAdapter`:
- **Resolve:** `POST /repositories/{ws}/{repo}/pullrequests/{id}/comments/{commentId}/resolve`
- **Unresolve:** `DELETE /repositories/{ws}/{repo}/pullrequests/{id}/comments/{commentId}/resolve`

---

## Global Error Handlers

Added to `index.ts` before `app.whenReady()`:

```typescript
process.on("unhandledRejection", (reason) => {
  console.error("[main] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[main] Uncaught exception:", err);
});
```
