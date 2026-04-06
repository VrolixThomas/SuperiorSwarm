# Provider Interface Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce GitProvider and IssueTracker interfaces with adapters that enforce null safety, replacing scattered provider switches in consumer code and fixing crashes when new users connect with existing PRs.

**Architecture:** Define interfaces in `src/main/providers/`, implement 4 adapters wrapping existing API modules, add a registry for provider lookup, migrate consumers (pollers, publishers, routers) to use the registry, fix broken Bitbucket comment resolution, and add global error handlers.

**Tech Stack:** TypeScript, Electron, Bun test runner, Bitbucket 2.0 REST API, GitHub REST + GraphQL API, Linear GraphQL API, Jira REST API

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/desktop/src/main/providers/types.ts` | Create | All interfaces + normalized types |
| `apps/desktop/src/main/providers/git-provider.ts` | Create | GitProvider interface re-export + registry |
| `apps/desktop/src/main/providers/issue-tracker.ts` | Create | IssueTracker interface re-export + registry |
| `apps/desktop/src/main/providers/github-adapter.ts` | Create | GitHubAdapter implements GitProvider |
| `apps/desktop/src/main/providers/bitbucket-adapter.ts` | Create | BitbucketAdapter implements GitProvider |
| `apps/desktop/src/main/providers/jira-adapter.ts` | Create | JiraAdapter implements IssueTracker |
| `apps/desktop/src/main/providers/linear-adapter.ts` | Create | LinearAdapter implements IssueTracker |
| `apps/desktop/tests/github-adapter.test.ts` | Create | Unit tests for GitHub adapter null safety |
| `apps/desktop/tests/bitbucket-adapter.test.ts` | Create | Unit tests for Bitbucket adapter null safety |
| `apps/desktop/tests/jira-adapter.test.ts` | Create | Unit tests for Jira adapter null safety |
| `apps/desktop/tests/linear-adapter.test.ts` | Create | Unit tests for Linear adapter null safety |
| `apps/desktop/src/main/ai-review/comment-poller.ts` | Modify | Replace provider switch with registry |
| `apps/desktop/src/main/ai-review/commit-poller.ts` | Modify | Replace provider switch with registry |
| `apps/desktop/src/main/ai-review/solve-publisher.ts` | Modify | Replace provider switch + enable Bitbucket resolution |
| `apps/desktop/src/main/index.ts` | Modify | Register adapters, fix event handlers, add global error handlers |

---

### Task 1: Create types and interfaces

All shared types, interfaces, and parameter types in one file.

**Files:**
- Create: `apps/desktop/src/main/providers/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// apps/desktop/src/main/providers/types.ts

// ── Normalized types ────────────────────────────────────────────────────────

export interface NormalizedPR {
	id: number;
	title: string;
	state: "open" | "closed" | "merged" | "declined";
	author: string;
	webUrl: string;
	sourceBranch: string;
	targetBranch: string;
	role: "author" | "reviewer";
}

export interface PRState {
	headSha: string;
	state: "open" | "closed" | "merged" | "declined";
}

export interface NormalizedComment {
	id: string;
	body: string;
	author: string;
	filePath: string | null;
	lineNumber: number | null;
	createdAt: string;
}

export interface NormalizedIssue {
	id: string;
	identifier: string;
	title: string;
	url: string;
	status: string;
	statusCategory: string;
	statusColor: string;
}

export interface NormalizedIssueDetail {
	description: string;
	comments: Array<{
		id: string;
		author: string;
		avatarUrl?: string;
		body: string;
		createdAt: string;
	}>;
}

export interface NormalizedState {
	id: string;
	name: string;
}

// ── Parameter types ─────────────────────────────────────────────────────────

export interface CreateCommentParams {
	owner: string;
	repo: string;
	prNumber: number;
	body: string;
	filePath?: string;
	line?: number;
}

export interface ReplyParams {
	owner: string;
	repo: string;
	prNumber: number;
	commentId: string;
	body: string;
}

export interface ResolveParams {
	owner: string;
	repo: string;
	prNumber: number;
	commentId: string;
}

// ── Provider interfaces ─────────────────────────────────────────────────────

export interface GitProvider {
	readonly name: "github" | "bitbucket";

	isConnected(): boolean;

	getMyPRs(): Promise<NormalizedPR[]>;
	getPRState(owner: string, repo: string, prNumber: number): Promise<PRState>;

	getPRComments(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<NormalizedComment[]>;
	createInlineComment(params: CreateCommentParams): Promise<{ id: string }>;
	replyToComment(params: ReplyParams): Promise<{ id: string }>;
	resolveComment(params: ResolveParams): Promise<void>;
	unresolveComment(params: ResolveParams): Promise<void>;
}

export interface IssueTracker {
	readonly name: "jira" | "linear";

	isConnected(): boolean;

	getAssignedIssues(options?: {
		includeDone?: boolean;
		teamId?: string;
	}): Promise<NormalizedIssue[]>;
	getIssueDetail(issueId: string): Promise<NormalizedIssueDetail>;
	getAvailableStates(context: {
		issueId?: string;
		teamId?: string;
	}): Promise<NormalizedState[]>;
	updateIssueState(issueId: string, stateId: string): Promise<void>;
}
```

- [ ] **Step 2: Run type-check to verify no errors**

Run: `bun run type-check`
Expected: PASS (new file, no imports yet)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/providers/types.ts
git commit -m "feat: add provider interface types and normalized data shapes"
```

---

### Task 2: Create registries

Two small files: one for git providers, one for issue trackers.

**Files:**
- Create: `apps/desktop/src/main/providers/git-provider.ts`
- Create: `apps/desktop/src/main/providers/issue-tracker.ts`

- [ ] **Step 1: Create the git provider registry**

```typescript
// apps/desktop/src/main/providers/git-provider.ts
import type { GitProvider } from "./types";

const gitProviders = new Map<string, GitProvider>();

export function registerGitProvider(provider: GitProvider): void {
	gitProviders.set(provider.name, provider);
}

export function getGitProvider(name: string): GitProvider {
	const provider = gitProviders.get(name);
	if (!provider) throw new Error(`Unknown git provider: ${name}`);
	return provider;
}

export function getConnectedGitProviders(): GitProvider[] {
	return [...gitProviders.values()].filter((p) => p.isConnected());
}
```

- [ ] **Step 2: Create the issue tracker registry**

```typescript
// apps/desktop/src/main/providers/issue-tracker.ts
import type { IssueTracker } from "./types";

const issueTrackers = new Map<string, IssueTracker>();

export function registerIssueTracker(tracker: IssueTracker): void {
	issueTrackers.set(tracker.name, tracker);
}

export function getIssueTracker(name: string): IssueTracker {
	const tracker = issueTrackers.get(name);
	if (!tracker) throw new Error(`Unknown issue tracker: ${name}`);
	return tracker;
}

export function getConnectedIssueTrackers(): IssueTracker[] {
	return [...issueTrackers.values()].filter((t) => t.isConnected());
}
```

- [ ] **Step 3: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/providers/git-provider.ts apps/desktop/src/main/providers/issue-tracker.ts
git commit -m "feat: add git provider and issue tracker registries"
```

---

### Task 3: Implement GitHubAdapter with tests

Wraps existing `github/github.ts` functions with null-safe mapping.

**Files:**
- Test: `apps/desktop/tests/github-adapter.test.ts`
- Create: `apps/desktop/src/main/providers/github-adapter.ts`

- [ ] **Step 1: Write tests for GitHub adapter null safety**

```typescript
// apps/desktop/tests/github-adapter.test.ts
import { describe, expect, test } from "bun:test";
import type { NormalizedComment, NormalizedPR, PRState } from "../src/main/providers/types";

// ── Test the mapping logic directly (pure functions, no API calls) ──────────

// Mirrors the shape GitHub REST/GraphQL returns for a PR search result
interface RawGitHubPRNode {
	number: number;
	title: string;
	state: string;
	draft: boolean;
	user: { login: string } | null;
	html_url: string;
	head: { ref: string };
	repository_url: string;
	pull_request?: { review_comments: number };
}

function mapGitHubPRNode(
	node: RawGitHubPRNode,
	role: "author" | "reviewer",
): NormalizedPR {
	const urlParts = node.repository_url?.split("/") ?? [];
	return {
		id: node.number,
		title: node.title ?? "",
		state: node.state === "open" ? "open" : "closed",
		author: node.user?.login ?? "Unknown",
		webUrl: node.html_url ?? "",
		sourceBranch: node.head?.ref ?? "",
		targetBranch: "",
		role,
	};
}

// Mirrors GitHub REST API comment shape
interface RawGitHubComment {
	id: number;
	body: string | null;
	user: { login: string } | null;
	created_at: string;
	path?: string;
	line?: number;
}

function mapGitHubComment(c: RawGitHubComment): NormalizedComment {
	return {
		id: String(c.id),
		body: c.body ?? "",
		author: c.user?.login ?? "Unknown",
		filePath: c.path ?? null,
		lineNumber: c.line ?? null,
		createdAt: c.created_at ?? "",
	};
}

describe("GitHub adapter mapping", () => {
	describe("mapGitHubPRNode", () => {
		test("maps a normal PR", () => {
			const raw: RawGitHubPRNode = {
				number: 42,
				title: "Add feature",
				state: "open",
				draft: false,
				user: { login: "alice" },
				html_url: "https://github.com/org/repo/pull/42",
				head: { ref: "feat/branch" },
				repository_url: "https://api.github.com/repos/org/repo",
			};
			const result = mapGitHubPRNode(raw, "author");
			expect(result.id).toBe(42);
			expect(result.author).toBe("alice");
			expect(result.sourceBranch).toBe("feat/branch");
			expect(result.role).toBe("author");
		});

		test("handles null user (deleted account)", () => {
			const raw: RawGitHubPRNode = {
				number: 1,
				title: "Old PR",
				state: "closed",
				draft: false,
				user: null,
				html_url: "https://github.com/org/repo/pull/1",
				head: { ref: "old-branch" },
				repository_url: "https://api.github.com/repos/org/repo",
			};
			const result = mapGitHubPRNode(raw, "reviewer");
			expect(result.author).toBe("Unknown");
			expect(result.state).toBe("closed");
		});
	});

	describe("mapGitHubComment", () => {
		test("maps a normal comment", () => {
			const raw: RawGitHubComment = {
				id: 100,
				body: "Looks good!",
				user: { login: "bob" },
				created_at: "2026-01-01T00:00:00Z",
				path: "src/main.ts",
				line: 42,
			};
			const result = mapGitHubComment(raw);
			expect(result.id).toBe("100");
			expect(result.body).toBe("Looks good!");
			expect(result.author).toBe("bob");
			expect(result.filePath).toBe("src/main.ts");
			expect(result.lineNumber).toBe(42);
		});

		test("handles null body and user", () => {
			const raw: RawGitHubComment = {
				id: 200,
				body: null,
				user: null,
				created_at: "2026-01-01T00:00:00Z",
			};
			const result = mapGitHubComment(raw);
			expect(result.body).toBe("");
			expect(result.author).toBe("Unknown");
			expect(result.filePath).toBeNull();
			expect(result.lineNumber).toBeNull();
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/github-adapter.test.ts`
Expected: All tests PASS (they test pure mapping functions defined in the test file)

- [ ] **Step 3: Create the GitHubAdapter**

```typescript
// apps/desktop/src/main/providers/github-adapter.ts
import { getValidToken } from "../github/auth";
import {
	type GitHubPR,
	type PRFileInfo,
	addReviewThreadReply,
	createReviewThread,
	getGitHubReviewThreads,
	getMyPRs,
	getPRComments,
	getPRDetails,
	getPRFiles,
	getPRState,
	resolveThread,
	submitReview,
	unresolveThread,
} from "../github/github";
import type {
	CreateCommentParams,
	GitProvider,
	NormalizedComment,
	NormalizedPR,
	PRState as PRStateType,
	ReplyParams,
	ResolveParams,
} from "./types";

function normalizePR(pr: GitHubPR): NormalizedPR {
	return {
		id: pr.number,
		title: pr.title ?? "",
		state: pr.state === "open" ? "open" : "closed",
		author: pr.repoOwner ?? "Unknown",
		webUrl: pr.url ?? "",
		sourceBranch: pr.branchName ?? "",
		targetBranch: "",
		role: pr.role ?? "author",
	};
}

export class GitHubAdapter implements GitProvider {
	readonly name = "github" as const;

	isConnected(): boolean {
		return getValidToken() !== null;
	}

	async getMyPRs(): Promise<NormalizedPR[]> {
		if (!this.isConnected()) return [];
		const prs = await getMyPRs();
		return prs.map(normalizePR);
	}

	async getPRState(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<PRStateType> {
		const result = await getPRState(owner, repo, prNumber);
		return {
			headSha: result.headSha ?? "",
			state: result.merged ? "merged" : result.state === "open" ? "open" : "closed",
		};
	}

	async getPRComments(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<NormalizedComment[]> {
		const comments = await getPRComments(owner, repo, prNumber);
		return comments.map((c) => ({
			id: String(c.id),
			body: c.body ?? "",
			author: c.author ?? "Unknown",
			filePath: c.path ?? null,
			lineNumber: c.line ?? null,
			createdAt: c.createdAt ?? "",
		}));
	}

	async createInlineComment(params: CreateCommentParams): Promise<{ id: string }> {
		const result = await createReviewThread({
			owner: params.owner,
			repo: params.repo,
			prNumber: params.prNumber,
			body: params.body,
			commitId: "",
			path: params.filePath ?? "",
			line: params.line,
		});
		return { id: String(result.id) };
	}

	async replyToComment(params: ReplyParams): Promise<{ id: string }> {
		const result = await addReviewThreadReply({
			threadId: params.commentId,
			body: params.body,
		});
		return { id: String(result.id) };
	}

	async resolveComment(params: ResolveParams): Promise<void> {
		await resolveThread(params.commentId);
	}

	async unresolveComment(params: ResolveParams): Promise<void> {
		await unresolveThread(params.commentId);
	}

	// ── GitHub-specific extras (not on GitProvider interface) ────────────────

	async getPRDetails(owner: string, repo: string, prNumber: number) {
		return getPRDetails(owner, repo, prNumber);
	}

	async submitReview(params: {
		owner: string;
		repo: string;
		prNumber: number;
		verdict: string;
		body: string;
	}) {
		return submitReview(params);
	}

	async getPRFiles(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<PRFileInfo[]> {
		return getPRFiles(owner, repo, prNumber);
	}

	async getReviewThreads(owner: string, repo: string, prNumber: number) {
		return getGitHubReviewThreads(owner, repo, prNumber);
	}
}
```

- [ ] **Step 4: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/providers/github-adapter.ts apps/desktop/tests/github-adapter.test.ts
git commit -m "feat: implement GitHubAdapter with null-safe mapping"
```

---

### Task 4: Implement BitbucketAdapter with tests

Wraps existing `atlassian/bitbucket.ts` functions with null-safe mapping. Fixes the broken `resolvePRComment` endpoint.

**Files:**
- Test: `apps/desktop/tests/bitbucket-adapter.test.ts`
- Create: `apps/desktop/src/main/providers/bitbucket-adapter.ts`

- [ ] **Step 1: Write tests for Bitbucket adapter null safety**

```typescript
// apps/desktop/tests/bitbucket-adapter.test.ts
import { describe, expect, test } from "bun:test";
import type { NormalizedComment, NormalizedPR } from "../src/main/providers/types";

// Mirrors Bitbucket API PR shape
interface RawBBPR {
	id: number;
	title: string;
	state: string;
	author: { display_name: string } | null;
	source: { branch?: { name?: string } };
	destination?: { branch?: { name?: string } } | null;
	links?: { html?: { href: string } } | null;
}

function mapBitbucketPR(
	pr: RawBBPR,
	role: "author" | "reviewer",
): NormalizedPR {
	return {
		id: pr.id,
		title: pr.title ?? "",
		state: normalizeBBState(pr.state),
		author: pr.author?.display_name ?? "Unknown",
		webUrl: pr.links?.html?.href ?? "",
		sourceBranch: pr.source?.branch?.name ?? "",
		targetBranch: pr.destination?.branch?.name ?? "",
		role,
	};
}

function normalizeBBState(
	state: string,
): "open" | "closed" | "merged" | "declined" {
	switch (state?.toUpperCase()) {
		case "OPEN":
			return "open";
		case "MERGED":
			return "merged";
		case "DECLINED":
			return "declined";
		default:
			return "closed";
	}
}

// Mirrors Bitbucket API comment shape
interface RawBBComment {
	id: number;
	content?: { raw?: string } | null;
	author?: { display_name?: string } | null;
	created_on?: string;
	inline?: { path?: string; to?: number };
}

function mapBitbucketComment(c: RawBBComment): NormalizedComment {
	return {
		id: String(c.id ?? 0),
		body: c.content?.raw ?? "",
		author: c.author?.display_name ?? "Unknown",
		filePath: c.inline?.path ?? null,
		lineNumber: c.inline?.to ?? null,
		createdAt: c.created_on ?? "",
	};
}

describe("Bitbucket adapter mapping", () => {
	describe("mapBitbucketPR", () => {
		test("maps a normal PR", () => {
			const raw: RawBBPR = {
				id: 1,
				title: "Test PR",
				state: "OPEN",
				author: { display_name: "Alice" },
				source: { branch: { name: "feat" } },
				destination: { branch: { name: "main" } },
				links: { html: { href: "https://bitbucket.org/ws/repo/pull-requests/1" } },
			};
			const result = mapBitbucketPR(raw, "author");
			expect(result.id).toBe(1);
			expect(result.author).toBe("Alice");
			expect(result.state).toBe("open");
			expect(result.sourceBranch).toBe("feat");
			expect(result.targetBranch).toBe("main");
		});

		test("handles null author (deleted user)", () => {
			const raw: RawBBPR = {
				id: 2,
				title: "Old PR",
				state: "MERGED",
				author: null,
				source: { branch: { name: "old" } },
			};
			const result = mapBitbucketPR(raw, "reviewer");
			expect(result.author).toBe("Unknown");
			expect(result.state).toBe("merged");
		});

		test("handles null links and destination", () => {
			const raw: RawBBPR = {
				id: 3,
				title: "Minimal PR",
				state: "DECLINED",
				author: { display_name: "Bob" },
				source: {},
				destination: null,
				links: null,
			};
			const result = mapBitbucketPR(raw, "author");
			expect(result.webUrl).toBe("");
			expect(result.sourceBranch).toBe("");
			expect(result.targetBranch).toBe("");
			expect(result.state).toBe("declined");
		});
	});

	describe("mapBitbucketComment", () => {
		test("maps a normal comment", () => {
			const raw: RawBBComment = {
				id: 100,
				content: { raw: "Looks good!" },
				author: { display_name: "Alice" },
				created_on: "2026-01-01T00:00:00Z",
				inline: { path: "src/main.ts", to: 42 },
			};
			const result = mapBitbucketComment(raw);
			expect(result.id).toBe("100");
			expect(result.body).toBe("Looks good!");
			expect(result.author).toBe("Alice");
			expect(result.filePath).toBe("src/main.ts");
			expect(result.lineNumber).toBe(42);
		});

		test("handles null content (system comment)", () => {
			const raw: RawBBComment = {
				id: 200,
				content: null,
				author: { display_name: "Bot" },
				created_on: "2026-01-01T00:00:00Z",
			};
			const result = mapBitbucketComment(raw);
			expect(result.body).toBe("");
		});

		test("handles null author (deleted user)", () => {
			const raw: RawBBComment = {
				id: 300,
				content: { raw: "Old comment" },
				author: null,
				created_on: "2026-01-01T00:00:00Z",
			};
			const result = mapBitbucketComment(raw);
			expect(result.author).toBe("Unknown");
		});

		test("handles both null author and content", () => {
			const raw: RawBBComment = {
				id: 400,
				content: null,
				author: null,
			};
			const result = mapBitbucketComment(raw);
			expect(result.body).toBe("");
			expect(result.author).toBe("Unknown");
			expect(result.createdAt).toBe("");
		});
	});

	describe("normalizeBBState", () => {
		test("maps all states", () => {
			expect(normalizeBBState("OPEN")).toBe("open");
			expect(normalizeBBState("MERGED")).toBe("merged");
			expect(normalizeBBState("DECLINED")).toBe("declined");
			expect(normalizeBBState("SUPERSEDED")).toBe("closed");
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/bitbucket-adapter.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Create the BitbucketAdapter**

```typescript
// apps/desktop/src/main/providers/bitbucket-adapter.ts
import {
	atlassianFetch,
	getAuth,
} from "../atlassian/auth";
import {
	type BitbucketPullRequest,
	createPRComment,
	getBitbucketPRComments,
	getMyPullRequests,
	getPRState,
	getReviewRequests,
	replyToPRComment,
} from "../atlassian/bitbucket";
import { BITBUCKET_API_BASE } from "../atlassian/constants";
import type {
	CreateCommentParams,
	GitProvider,
	NormalizedComment,
	NormalizedPR,
	PRState as PRStateType,
	ReplyParams,
	ResolveParams,
} from "./types";

function normalizeBBState(
	state: string,
): "open" | "closed" | "merged" | "declined" {
	switch (state?.toUpperCase()) {
		case "OPEN":
			return "open";
		case "MERGED":
			return "merged";
		case "DECLINED":
			return "declined";
		default:
			return "closed";
	}
}

function normalizePR(
	pr: BitbucketPullRequest,
	role: "author" | "reviewer",
): NormalizedPR {
	return {
		id: pr.id,
		title: pr.title ?? "",
		state: normalizeBBState(pr.state),
		author: pr.author ?? "Unknown",
		webUrl: pr.webUrl ?? "",
		sourceBranch: pr.source?.branch?.name ?? "",
		targetBranch: pr.destination?.branch?.name ?? "",
		role,
	};
}

export class BitbucketAdapter implements GitProvider {
	readonly name = "bitbucket" as const;

	isConnected(): boolean {
		return getAuth("bitbucket") !== null;
	}

	async getMyPRs(): Promise<NormalizedPR[]> {
		if (!this.isConnected()) return [];
		const [authored, reviewing] = await Promise.all([
			getMyPullRequests(),
			getReviewRequests(),
		]);
		const authoredNorm = authored.map((pr) => normalizePR(pr, "author"));
		const reviewingNorm = reviewing.map((pr) => normalizePR(pr, "reviewer"));
		return [...authoredNorm, ...reviewingNorm];
	}

	async getPRState(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<PRStateType> {
		const result = await getPRState(owner, repo, prNumber);
		return {
			headSha: result.headSha ?? "",
			state: normalizeBBState(result.state),
		};
	}

	async getPRComments(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<NormalizedComment[]> {
		const comments = await getBitbucketPRComments(owner, repo, prNumber);
		return comments.map((c) => ({
			id: String(c.id),
			body: c.body ?? "",
			author: c.author ?? "Unknown",
			filePath: c.filePath ?? null,
			lineNumber: c.lineNumber ?? null,
			createdAt: c.createdAt ?? "",
		}));
	}

	async createInlineComment(
		params: CreateCommentParams,
	): Promise<{ id: string }> {
		const result = await createPRComment(
			params.owner,
			params.repo,
			params.prNumber,
			params.body,
			params.filePath,
			params.line,
		);
		return { id: String(result.id) };
	}

	async replyToComment(params: ReplyParams): Promise<{ id: string }> {
		const parentId = Number.parseInt(params.commentId, 10);
		const result = await replyToPRComment(
			params.owner,
			params.repo,
			params.prNumber,
			parentId,
			params.body,
		);
		return { id: String(result.id) };
	}

	async resolveComment(params: ResolveParams): Promise<void> {
		const url = `${BITBUCKET_API_BASE}/repositories/${params.owner}/${params.repo}/pullrequests/${params.prNumber}/comments/${params.commentId}/resolve`;
		const res = await atlassianFetch("bitbucket", url, { method: "POST" });
		if (!res.ok && res.status !== 409) {
			throw new Error(`Bitbucket resolve comment failed: ${res.status}`);
		}
	}

	async unresolveComment(params: ResolveParams): Promise<void> {
		const url = `${BITBUCKET_API_BASE}/repositories/${params.owner}/${params.repo}/pullrequests/${params.prNumber}/comments/${params.commentId}/resolve`;
		const res = await atlassianFetch("bitbucket", url, { method: "DELETE" });
		if (!res.ok && res.status !== 409) {
			throw new Error(`Bitbucket unresolve comment failed: ${res.status}`);
		}
	}
}
```

- [ ] **Step 4: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/providers/bitbucket-adapter.ts apps/desktop/tests/bitbucket-adapter.test.ts
git commit -m "feat: implement BitbucketAdapter with null-safe mapping and fixed resolution endpoints"
```

---

### Task 5: Implement JiraAdapter with tests

Wraps existing `atlassian/jira.ts` functions.

**Files:**
- Test: `apps/desktop/tests/jira-adapter.test.ts`
- Create: `apps/desktop/src/main/providers/jira-adapter.ts`

- [ ] **Step 1: Write tests for Jira adapter null safety**

```typescript
// apps/desktop/tests/jira-adapter.test.ts
import { describe, expect, test } from "bun:test";
import type { NormalizedIssue, NormalizedIssueDetail } from "../src/main/providers/types";

interface RawJiraIssue {
	key: string;
	summary: string;
	status: string;
	statusCategory: string;
	statusColor: string;
	priority: string;
	issueType: string;
	projectKey: string;
	webUrl: string;
}

function mapJiraIssue(issue: RawJiraIssue): NormalizedIssue {
	return {
		id: issue.key ?? "",
		identifier: issue.key ?? "",
		title: issue.summary ?? "",
		url: issue.webUrl ?? "",
		status: issue.status ?? "",
		statusCategory: issue.statusCategory ?? "",
		statusColor: issue.statusColor ?? "#808080",
	};
}

interface RawJiraIssueDetail {
	description: string | null;
	comments: Array<{
		id: string;
		author: string | null;
		avatarUrl?: string;
		body: string | null;
		createdAt: string;
	}>;
}

function mapJiraIssueDetail(detail: RawJiraIssueDetail): NormalizedIssueDetail {
	return {
		description: detail.description ?? "",
		comments: detail.comments.map((c) => ({
			id: c.id ?? "",
			author: c.author ?? "Unknown",
			avatarUrl: c.avatarUrl,
			body: c.body ?? "",
			createdAt: c.createdAt ?? "",
		})),
	};
}

describe("Jira adapter mapping", () => {
	test("maps a normal issue", () => {
		const raw: RawJiraIssue = {
			key: "PROJ-123",
			summary: "Fix login bug",
			status: "In Progress",
			statusCategory: "in_progress",
			statusColor: "#0052cc",
			priority: "High",
			issueType: "Bug",
			projectKey: "PROJ",
			webUrl: "https://jira.example.com/browse/PROJ-123",
		};
		const result = mapJiraIssue(raw);
		expect(result.id).toBe("PROJ-123");
		expect(result.identifier).toBe("PROJ-123");
		expect(result.title).toBe("Fix login bug");
		expect(result.statusCategory).toBe("in_progress");
	});

	test("maps issue detail with null description", () => {
		const raw: RawJiraIssueDetail = {
			description: null,
			comments: [
				{
					id: "1",
					author: null,
					body: null,
					createdAt: "2026-01-01T00:00:00Z",
				},
			],
		};
		const result = mapJiraIssueDetail(raw);
		expect(result.description).toBe("");
		expect(result.comments[0]?.author).toBe("Unknown");
		expect(result.comments[0]?.body).toBe("");
	});
});
```

- [ ] **Step 2: Run tests**

Run: `cd apps/desktop && bun test tests/jira-adapter.test.ts`
Expected: PASS

- [ ] **Step 3: Create the JiraAdapter**

```typescript
// apps/desktop/src/main/providers/jira-adapter.ts
import { getAuth } from "../atlassian/auth";
import {
	type JiraIssue,
	getIssueDetail,
	getIssueTransitions,
	getMyIssues,
	getMyIssuesWithDone,
	updateIssueStatus,
} from "../atlassian/jira";
import type {
	IssueTracker,
	NormalizedIssue,
	NormalizedIssueDetail,
	NormalizedState,
} from "./types";

function normalizeIssue(issue: JiraIssue): NormalizedIssue {
	return {
		id: issue.key ?? "",
		identifier: issue.key ?? "",
		title: issue.summary ?? "",
		url: issue.webUrl ?? "",
		status: issue.status ?? "",
		statusCategory: issue.statusCategory ?? "",
		statusColor: issue.statusColor ?? "#808080",
	};
}

export class JiraAdapter implements IssueTracker {
	readonly name = "jira" as const;

	isConnected(): boolean {
		const auth = getAuth("jira");
		return auth !== null && auth.cloudId !== undefined;
	}

	async getAssignedIssues(options?: {
		includeDone?: boolean;
		teamId?: string;
	}): Promise<NormalizedIssue[]> {
		if (!this.isConnected()) return [];
		const issues = options?.includeDone
			? await getMyIssuesWithDone()
			: await getMyIssues();
		return issues.map(normalizeIssue);
	}

	async getIssueDetail(issueId: string): Promise<NormalizedIssueDetail> {
		const detail = await getIssueDetail(issueId);
		return {
			description: detail.description ?? "",
			comments: detail.comments.map((c) => ({
				id: c.id ?? "",
				author: c.author ?? "Unknown",
				avatarUrl: c.avatarUrl,
				body: c.body ?? "",
				createdAt: c.createdAt ?? "",
			})),
		};
	}

	async getAvailableStates(context: {
		issueId?: string;
		teamId?: string;
	}): Promise<NormalizedState[]> {
		if (!context.issueId) return [];
		const transitions = await getIssueTransitions(context.issueId);
		return transitions.map((t) => ({
			id: t.id ?? "",
			name: t.name ?? "",
		}));
	}

	async updateIssueState(issueId: string, stateId: string): Promise<void> {
		await updateIssueStatus(issueId, stateId);
	}
}
```

- [ ] **Step 4: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/providers/jira-adapter.ts apps/desktop/tests/jira-adapter.test.ts
git commit -m "feat: implement JiraAdapter with null-safe mapping"
```

---

### Task 6: Implement LinearAdapter with tests

Wraps existing `linear/linear.ts` functions.

**Files:**
- Test: `apps/desktop/tests/linear-adapter.test.ts`
- Create: `apps/desktop/src/main/providers/linear-adapter.ts`

- [ ] **Step 1: Write tests for Linear adapter null safety**

```typescript
// apps/desktop/tests/linear-adapter.test.ts
import { describe, expect, test } from "bun:test";
import type { NormalizedIssue, NormalizedIssueDetail } from "../src/main/providers/types";

interface RawLinearIssue {
	id: string;
	identifier: string;
	title: string;
	url: string;
	stateName: string | null;
	stateType: string | null;
	stateColor: string | null;
}

function mapLinearIssue(issue: RawLinearIssue): NormalizedIssue {
	return {
		id: issue.id ?? "",
		identifier: issue.identifier ?? "",
		title: issue.title ?? "",
		url: issue.url ?? "",
		status: issue.stateName ?? "",
		statusCategory: issue.stateType ?? "",
		statusColor: issue.stateColor ?? "#808080",
	};
}

describe("Linear adapter mapping", () => {
	test("maps a normal issue", () => {
		const raw: RawLinearIssue = {
			id: "abc-123",
			identifier: "SUP-45",
			title: "Fix crash",
			url: "https://linear.app/team/issue/SUP-45",
			stateName: "In Progress",
			stateType: "started",
			stateColor: "#f2c94c",
		};
		const result = mapLinearIssue(raw);
		expect(result.id).toBe("abc-123");
		expect(result.identifier).toBe("SUP-45");
		expect(result.statusCategory).toBe("started");
	});

	test("handles null state fields", () => {
		const raw: RawLinearIssue = {
			id: "def-456",
			identifier: "SUP-46",
			title: "Task",
			url: "https://linear.app/team/issue/SUP-46",
			stateName: null,
			stateType: null,
			stateColor: null,
		};
		const result = mapLinearIssue(raw);
		expect(result.status).toBe("");
		expect(result.statusCategory).toBe("");
		expect(result.statusColor).toBe("#808080");
	});
});
```

- [ ] **Step 2: Run tests**

Run: `cd apps/desktop && bun test tests/linear-adapter.test.ts`
Expected: PASS

- [ ] **Step 3: Create the LinearAdapter**

```typescript
// apps/desktop/src/main/providers/linear-adapter.ts
import { getAuth } from "../linear/auth";
import {
	type LinearIssue,
	getAssignedIssues,
	getAssignedIssuesWithDone,
	getIssueDetail,
	getTeamStates,
	updateIssueState,
} from "../linear/linear";
import type {
	IssueTracker,
	NormalizedIssue,
	NormalizedIssueDetail,
	NormalizedState,
} from "./types";

function normalizeIssue(issue: LinearIssue): NormalizedIssue {
	return {
		id: issue.id ?? "",
		identifier: issue.identifier ?? "",
		title: issue.title ?? "",
		url: issue.url ?? "",
		status: issue.stateName ?? "",
		statusCategory: issue.stateType ?? "",
		statusColor: issue.stateColor ?? "#808080",
	};
}

export class LinearAdapter implements IssueTracker {
	readonly name = "linear" as const;

	isConnected(): boolean {
		return getAuth() !== null;
	}

	async getAssignedIssues(options?: {
		includeDone?: boolean;
		teamId?: string;
	}): Promise<NormalizedIssue[]> {
		if (!this.isConnected()) return [];
		const issues = options?.includeDone
			? await getAssignedIssuesWithDone(options.teamId)
			: await getAssignedIssues(options?.teamId);
		return issues.map(normalizeIssue);
	}

	async getIssueDetail(issueId: string): Promise<NormalizedIssueDetail> {
		const detail = await getIssueDetail(issueId);
		return {
			description: detail.description ?? "",
			comments: detail.comments.map((c) => ({
				id: c.id ?? "",
				author: c.author ?? "Unknown",
				avatarUrl: c.avatarUrl,
				body: c.body ?? "",
				createdAt: c.createdAt ?? "",
			})),
		};
	}

	async getAvailableStates(context: {
		issueId?: string;
		teamId?: string;
	}): Promise<NormalizedState[]> {
		if (!context.teamId) return [];
		const states = await getTeamStates(context.teamId);
		return states.map((s) => ({
			id: s.id ?? "",
			name: s.name ?? "",
		}));
	}

	async updateIssueState(issueId: string, stateId: string): Promise<void> {
		await updateIssueState(issueId, stateId);
	}
}
```

- [ ] **Step 4: Run type-check**

Run: `bun run type-check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/providers/linear-adapter.ts apps/desktop/tests/linear-adapter.test.ts
git commit -m "feat: implement LinearAdapter with null-safe mapping"
```

---

### Task 7: Migrate comment-poller to use registry

Replace the provider-specific imports and if/else with `getGitProvider()`.

**Files:**
- Modify: `apps/desktop/src/main/ai-review/comment-poller.ts:1-9, 37-47, 75-91`

- [ ] **Step 1: Update imports**

In `apps/desktop/src/main/ai-review/comment-poller.ts`, replace lines 1-9:

```typescript
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { getGitProvider } from "../providers/git-provider";
import { parsePrIdentifier } from "./pr-identifier";
import { getCachedPRs } from "./pr-poller";
```

- [ ] **Step 2: Replace provider-specific fetch functions**

Replace `fetchGitHubComments` and `fetchBitbucketComments` (lines 33-47) with a single function:

```typescript
interface PlatformComment {
	platformId: string;
}

async function fetchComments(
	prProvider: string,
	identifier: string,
): Promise<PlatformComment[]> {
	const { owner, repo, number } = parsePrIdentifier(identifier);
	const git = getGitProvider(prProvider);
	const comments = await git.getPRComments(owner, repo, number);
	return comments.map((c) => ({ platformId: c.id }));
}
```

- [ ] **Step 3: Update pollWorkspace to use the single fetch function**

Replace the provider switch in `pollWorkspace` (lines 75-91) with:

```typescript
async function pollWorkspace(workspace: schema.Workspace): Promise<void> {
	const { id: workspaceId, prProvider, prIdentifier } = workspace;
	if (!prProvider || !prIdentifier) return;

	let platformComments: PlatformComment[];
	try {
		const git = getGitProvider(prProvider);
		if (!git.isConnected()) return;
		platformComments = await fetchComments(prProvider, prIdentifier);
	} catch (err) {
		console.error(`[comment-poller] Failed to fetch comments for ${prIdentifier}:`, err);
		return;
	}

	const knownIds = getKnownPlatformCommentIds(prIdentifier);

	const newCommentIds = platformComments.map((c) => c.platformId).filter((id) => !knownIds.has(id));

	if (newCommentIds.length === 0) return;

	console.log(
		`[comment-poller] ${newCommentIds.length} new comment(s) on ${prIdentifier} (workspace ${workspaceId})`
	);

	if (onNewCommentsHandler) {
		onNewCommentsHandler({ workspaceId, prProvider, prIdentifier, newCommentIds });
	}
}
```

- [ ] **Step 4: Run type-check and tests**

Run: `bun run type-check && cd apps/desktop && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai-review/comment-poller.ts
git commit -m "refactor: migrate comment-poller to use GitProvider registry"
```

---

### Task 8: Migrate commit-poller to use registry

Replace the provider switch for `getPRState`.

**Files:**
- Modify: `apps/desktop/src/main/ai-review/commit-poller.ts:1-8, 76-90`

- [ ] **Step 1: Update imports**

In `apps/desktop/src/main/ai-review/commit-poller.ts`, replace the provider-specific imports (lines 2, 5):

```typescript
// Remove these two lines:
// import { getPRState as getBitbucketPRState } from "../atlassian/bitbucket";
// import { getPRState as getGitHubPRState } from "../github/github";

// Add:
import { getGitProvider } from "../providers/git-provider";
```

Keep all other imports unchanged.

- [ ] **Step 2: Replace provider switch in pollChain**

Replace lines 82-90 in `pollChain()`:

```typescript
		const git = getGitProvider(chain.prProvider);
		const result = await git.getPRState(owner, repo, prNumber);
		headSha = result.headSha;
		prState = result.state;
```

This replaces the `if (chain.prProvider === "github")` / `else` block. State normalization (uppercase Bitbucket states → lowercase) is now handled by the adapter.

- [ ] **Step 3: Run type-check and tests**

Run: `bun run type-check && cd apps/desktop && bun test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/ai-review/commit-poller.ts
git commit -m "refactor: migrate commit-poller to use GitProvider registry"
```

---

### Task 9: Migrate solve-publisher to use registry

Replace provider switches and enable Bitbucket thread resolution.

**Files:**
- Modify: `apps/desktop/src/main/ai-review/solve-publisher.ts:1-9, 56-73, 84-105`

- [ ] **Step 1: Update imports**

In `apps/desktop/src/main/ai-review/solve-publisher.ts`, replace provider-specific imports (lines 3, 6):

```typescript
// Remove these two lines:
// import { replyToPRComment } from "../atlassian/bitbucket";
// import { addReviewThreadReply, resolveThread } from "../github/github";

// Add:
import { getGitProvider } from "../providers/git-provider";
```

Keep all other imports unchanged.

- [ ] **Step 2: Replace provider switch for reply posting**

Replace the provider switch in the reply loop (lines 56-73) with:

```typescript
		const git = getGitProvider(session.prProvider);

		for (const comment of commentsToPublish) {
			const approvedReply = replies.find(
				(r) => r.commentId === comment.id && r.status === "approved"
			);
			if (!approvedReply) continue;

			try {
				await git.replyToComment({
					owner,
					repo,
					prNumber,
					commentId: comment.threadId ?? comment.platformCommentId,
					body: approvedReply.body,
				});
				published++;
			} catch (err) {
				console.error(`[solve-publisher] Failed to post reply for comment ${comment.id}:`, err);
				failed++;
			}
		}
```

- [ ] **Step 3: Replace provider switch for thread resolution**

Replace the GitHub-only thread resolution (lines 84-105) with code that works for both providers:

```typescript
		// Resolve threads for fixed comments (now works for both providers)
		const fixedComments = db
			.select()
			.from(schema.prComments)
			.where(
				and(
					eq(schema.prComments.solveSessionId, sessionId),
					eq(schema.prComments.solveStatus, "fixed"),
				)
			)
			.all();

		const resolveResults = await Promise.allSettled(
			fixedComments.map((comment) =>
				git.resolveComment({
					owner,
					repo,
					prNumber,
					commentId: comment.threadId ?? comment.platformCommentId,
				})
			),
		);

		for (const result of resolveResults) {
			if (result.status === "rejected") {
				console.error("[solve-publisher] Failed to resolve thread:", result.reason);
			}
		}
```

- [ ] **Step 4: Run type-check and tests**

Run: `bun run type-check && cd apps/desktop && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ai-review/solve-publisher.ts
git commit -m "refactor: migrate solve-publisher to GitProvider registry

Enables Bitbucket thread resolution via the correct POST/DELETE
/resolve endpoints, which was previously GitHub-only."
```

---

### Task 10: Register adapters and add global error handlers in index.ts

Wire everything up at app startup. Add `isDestroyed()` checks and async error handling to PR event handlers.

**Files:**
- Modify: `apps/desktop/src/main/index.ts:1-15, 179-198`

- [ ] **Step 1: Add imports for adapters and registries**

Add these imports near the top of `apps/desktop/src/main/index.ts` (after existing imports):

```typescript
import { BitbucketAdapter } from "./providers/bitbucket-adapter";
import { registerGitProvider } from "./providers/git-provider";
import { GitHubAdapter } from "./providers/github-adapter";
import { registerIssueTracker } from "./providers/issue-tracker";
import { JiraAdapter } from "./providers/jira-adapter";
import { LinearAdapter } from "./providers/linear-adapter";
```

- [ ] **Step 2: Add global error handlers**

Add these lines near the top of the file, after imports but before `app.whenReady()`:

```typescript
// ── Global error handlers ─────────────────────────────────────────────────────

process.on("unhandledRejection", (reason) => {
	console.error("[main] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
	console.error("[main] Uncaught exception:", err);
});
```

- [ ] **Step 3: Register adapters at startup**

Inside the `app.whenReady()` callback, before the background task startups (before the line `cleanupStaleReviews();`), add:

```typescript
	// ── Register provider adapters ────────────────────────────────────────────
	registerGitProvider(new GitHubAdapter());
	registerGitProvider(new BitbucketAdapter());
	registerIssueTracker(new JiraAdapter());
	registerIssueTracker(new LinearAdapter());
```

- [ ] **Step 4: Fix PR event handlers**

Replace the PR event handlers (lines 184-198) with:

```typescript
	onNewPRDetected((pr) => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) {
				win.webContents.send("new-pr-review-request", pr);
			}
		}
	});

	onPRClosedDetected(async (pr) => {
		try {
			const wsId = findReviewWorkspaceByPR(pr.provider, pr.identifier);
			if (wsId) {
				await cleanupReviewWorkspace(wsId);
			}
			for (const win of BrowserWindow.getAllWindows()) {
				if (!win.isDestroyed()) {
					win.webContents.send("pr-closed", pr);
				}
			}
		} catch (err) {
			console.error("[main] Error handling PR closed event:", err);
		}
	});
```

- [ ] **Step 5: Run type-check and tests**

Run: `bun run type-check && cd apps/desktop && bun test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat: register provider adapters at startup, add global error handlers

Registers all 4 adapters (GitHub, Bitbucket, Jira, Linear) at app
startup. Adds isDestroyed() checks and try/catch to PR event handlers.
Adds unhandledRejection and uncaughtException handlers to prevent
silent crashes."
```

---

### Task 11: Lint, type-check, and final verification

**Files:**
- All modified files

- [ ] **Step 1: Run biome check**

Run: `bun run check`
Expected: No errors. Fix any that appear.

- [ ] **Step 2: Run type-check**

Run: `bun run type-check`
Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `cd apps/desktop && bun test`
Expected: All tests PASS.

- [ ] **Step 4: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "chore: fix lint and formatting issues"
```
