# PR Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the left-sidebar PRs tab use the same visual chrome as the Repos tab, so each PR's parent repo is instantly identifiable. Add an "active group + active PR row" highlight that mirrors the Repos tab's "active project + active workspace" pattern.

**Architecture:** Extract the existing inlined chrome from `ProjectItem.tsx` (accent stripe, gradient header, chevron, hover/active states) into a new presentational primitive `RepoGroup`. Refactor `ProjectItem` to render through it (no behavior change). Build a new `PullRequestGroup` that also renders through `RepoGroup` and contains `RichPRItem` rows. Add `isActive` / `isInActiveGroup` props to `RichPRItem` so an active PR row gets the same dark-bg + stripe treatment as an active workspace row. Two pure helpers (`resolveDisplayName`, `findActivePRIdentifier`) are TDD-tested with `bun:test`; the visual chrome is verified manually since the project has no React Testing Library setup.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Zustand, tRPC, Bun test runner, Biome (lint + format).

**Spec:** `docs/superpowers/specs/2026-04-08-pr-panel-redesign-design.md`

---

## File Changes Overview

| File | Change |
|---|---|
| `apps/desktop/src/renderer/components/RepoGroup.tsx` | **New.** Presentational chrome primitive (accent stripe, gradient header, chevron). |
| `apps/desktop/src/renderer/components/ProjectItem.tsx` | **Modify.** Render through `RepoGroup`, no behavior change. |
| `apps/desktop/src/renderer/components/pr-panel-helpers.ts` | **New.** Pure helpers: `resolveDisplayName`, `findActivePRIdentifier`. |
| `apps/desktop/tests/pr-panel-helpers.test.ts` | **New.** Bun tests for the helpers. |
| `apps/desktop/src/renderer/components/PullRequestItem.tsx` | **New.** Extracted from `PullRequestsTab.tsx` so `PullRequestGroup` can import it. Holds `RichPRItem`, `ReviewerAvatar`, `EnrichmentSkeleton`, `MergedPR` interface, `initials`, `getHealthColor`. |
| `apps/desktop/src/renderer/components/PullRequestGroup.tsx` | **New.** Wraps `RepoGroup` with PR-specific props (count badge, active-PR derivation). |
| `apps/desktop/src/renderer/components/PullRequestsTab.tsx` | **Modify.** Replace inlined group rendering with `PullRequestGroup`. Derive `activePRIdentifier`. Add `owner`/`repo` to grouped Map value. |

### Spec deviation note

The spec lists `RichPRItem` extraction as out of scope. This plan extracts it to `PullRequestItem.tsx` because `PullRequestGroup` (which the spec mandates as a new file) needs to import it. The extraction is a mechanical move-and-export — no behavior or content changes — and is the minimum work needed to satisfy the spec's component-boundary requirements. The "out of scope" intent (don't refactor RichPRItem's internals) is preserved.

---

### Task 1: Create `RepoGroup` shared primitive

**Files:**
- Create: `apps/desktop/src/renderer/components/RepoGroup.tsx`

**Context:** This component owns the visual chrome that's currently inlined inside `ProjectItem.tsx` (lines 64–158). It is purely presentational — no data fetching, no store reads, no useState. Both `ProjectItem` and the new `PullRequestGroup` will render through it.

The original chrome behavior to mirror exactly:

- When `isActive && isExpanded`: outer wrapper has a 2px left accent stripe; header has a gradient bg and rounded right corners.
- When inactive: header is transparent with a hover background; rounded all corners.
- Header content order (left-to-right): name (with optional subTitle below) → optional rightContent → chevron.
- Chevron rotates 90° when `isExpanded`.
- All transitions are 120ms.

- [ ] **Step 1: Create the file**

Write `apps/desktop/src/renderer/components/RepoGroup.tsx`:

```tsx
import type { ReactNode } from "react";

interface RepoGroupProps {
	name: string;
	isActive: boolean;
	isExpanded: boolean;
	onToggle?: () => void;
	onContextMenu?: (e: React.MouseEvent) => void;
	subTitle?: ReactNode;
	rightContent?: ReactNode;
	children?: ReactNode;
}

/**
 * Presentational chrome for a repo group in the left sidebar.
 * Used by both `ProjectItem` (Repos tab) and `PullRequestGroup` (PRs tab)
 * so the two tabs render through identical visual primitives.
 */
export function RepoGroup({
	name,
	isActive,
	isExpanded,
	onToggle,
	onContextMenu,
	subTitle,
	rightContent,
	children,
}: RepoGroupProps) {
	const showActiveChrome = isActive && isExpanded;

	return (
		<div
			style={
				showActiveChrome
					? {
							borderLeft: "2px solid rgba(10, 132, 255, 0.19)",
							borderRadius: 2,
						}
					: undefined
			}
		>
			<button
				type="button"
				onClick={onToggle}
				onContextMenu={onContextMenu}
				className={[
					"flex w-full items-center gap-2 border-none px-3 py-1.5 cursor-pointer",
					"transition-all duration-[120ms] text-left",
					showActiveChrome ? "rounded-r-[8px] rounded-l-none" : "rounded-[8px]",
					isActive ? "text-[var(--text)]" : "text-[#505058]",
					showActiveChrome
						? "bg-gradient-to-br from-[#1a1a24] to-[#16161e]"
						: "bg-transparent hover:bg-[var(--bg-elevated)]",
				].join(" ")}
			>
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] font-semibold">{name}</div>
					{subTitle}
				</div>

				{rightContent}

				<svg
					aria-hidden="true"
					width="10"
					height="10"
					viewBox="0 0 10 10"
					fill="none"
					className={[
						"shrink-0 transition-transform duration-[120ms]",
						isExpanded ? "rotate-90" : "rotate-0",
						isActive ? "text-[var(--text-quaternary)]" : "text-[#3a3a42]",
					].join(" ")}
				>
					<path
						d="M3 1.5L7 5L3 8.5"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>

			{isExpanded && children}
		</div>
	);
}
```

- [ ] **Step 2: Type-check**

Run from repo root:

```bash
bun run type-check
```

Expected: no new errors. The new file imports only React types.

- [ ] **Step 3: Lint + format**

```bash
bun run check
```

Expected: no errors; biome may auto-fix tab/space alignment.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/RepoGroup.tsx
git commit -m "feat(renderer): add shared RepoGroup chrome primitive"
```

---

### Task 2: Refactor `ProjectItem.tsx` to render through `RepoGroup`

**Files:**
- Modify: `apps/desktop/src/renderer/components/ProjectItem.tsx:63-184`

**Context:** `ProjectItem` currently inlines the chrome (the `<div style={...}>` wrapper, the header `<button>`, the chevron SVG). After this task, those elements come from `RepoGroup`. `ProjectItem` continues to own clone polling, workspace fetching, the create-worktree modal trigger, and the context menu — only the chrome rendering moves.

The visible result must be identical to before. We verify with manual inspection.

- [ ] **Step 1: Replace the render block**

Open `apps/desktop/src/renderer/components/ProjectItem.tsx`. Replace the entire `return (...)` block (currently lines 63–185) with:

```tsx
	return (
		<>
			<RepoGroup
				name={project.name}
				isActive={isActiveProject}
				isExpanded={isExpanded}
				onToggle={isReady ? onToggle : undefined}
				onContextMenu={(e) => {
					e.preventDefault();
					setContextMenu({ x: e.clientX, y: e.clientY });
				}}
				subTitle={
					isCloning ? (
						<div className="text-[11px] text-[var(--text-quaternary)]">
							{progress ? `${progress.stage}... ${progress.progress}%` : "Cloning..."}
						</div>
					) : undefined
				}
				rightContent={
					isReady ? (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								openCreateWorktreeModal(project.id);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.stopPropagation();
									openCreateWorktreeModal(project.id);
								}
							}}
							className={[
								"flex h-5 w-5 shrink-0 items-center justify-center rounded text-[14px]",
								"transition-colors duration-[120ms]",
								isActiveProject
									? "text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
									: "text-[#3a3a42] hover:text-[#505058]",
							].join(" ")}
							title="New Worktree"
						>
							+
						</button>
					) : undefined
				}
			>
				{isReady && workspacesList && (
					<div className="flex flex-col pt-0.5">
						{visibleWorkspaces.map((ws) => (
							<WorkspaceItem
								key={ws.id}
								workspace={ws}
								projectId={project.id}
								projectName={project.name}
								projectRepoPath={project.repoPath}
								isInActiveProject={isActiveProject}
							/>
						))}
					</div>
				)}
			</RepoGroup>

			{contextMenu && (
				<ProjectContextMenu
					project={project}
					position={contextMenu}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</>
	);
}
```

Note: the `isCloning` guard previously also dimmed the project name (`isCloning ? "opacity-60" : ""`). That dimming is intentionally dropped to keep `RepoGroup` purely presentational; the cloning state is still visible via `subTitle`. If you want to preserve the dim-while-cloning behavior, add `style={{ opacity: isCloning ? 0.6 : 1 }}` to the `RepoGroup` wrapper as a follow-up — for now, leave it out.

- [ ] **Step 2: Add the import**

At the top of `ProjectItem.tsx`, add to the existing import block:

```tsx
import { RepoGroup } from "./RepoGroup";
```

- [ ] **Step 3: Type-check**

```bash
bun run type-check
```

Expected: no new errors. If TypeScript complains about an unused import (e.g., the inlined SVG no longer needs anything), remove it.

- [ ] **Step 4: Lint + format**

```bash
bun run check
```

- [ ] **Step 5: Manual visual verification**

```bash
bun run dev
```

In the running app, verify:

1. The Repos tab still renders projects with the same look as before.
2. Click a project to expand it — chevron rotates, workspaces appear below.
3. Switch to a workspace inside an expanded project — the project header gets the gradient + accent stripe.
4. Hover an inactive project — background goes to `--bg-elevated`.
5. Right-click a project — context menu still appears.
6. Click the `+` button on an active project — the create-worktree modal opens (the `+` button is still a child of the header but `e.stopPropagation()` keeps it from toggling the project).
7. Cloning progress text appears below the project name when a project is in `cloning` state (use a fresh clone to verify, or skip if no project is currently cloning).

If anything looks off, fix the inline element causing the regression and re-verify.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/ProjectItem.tsx
git commit -m "refactor(renderer): render ProjectItem through RepoGroup"
```

---

### Task 3: Add `pr-panel-helpers.ts` with TDD

**Files:**
- Create: `apps/desktop/src/renderer/components/pr-panel-helpers.ts`
- Create: `apps/desktop/tests/pr-panel-helpers.test.ts`

**Context:** Two pure helpers used by `PullRequestGroup` and `PullRequestsTab`:

1. `resolveDisplayName(group, projectsList)` — given a PR group and the project list, returns the local `Project.name` when the repo is cloned, otherwise falls back to `${owner}/${repo}`.
2. `findActivePRIdentifier(workspaceIdMap, activeWorkspaceId)` — given the PR-identifier-to-workspace-ID map and the currently active workspace ID, returns the identifier of the PR whose workspace is active, or `null`.

These are the only TDD-testable pieces. The `Project` type is imported from the schema; we re-derive a small structural type so the helper file doesn't need a Drizzle type import.

- [ ] **Step 1: Write the failing test file**

Write `apps/desktop/tests/pr-panel-helpers.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
	findActivePRIdentifier,
	resolveDisplayName,
} from "../src/renderer/components/pr-panel-helpers";

const project = (overrides: {
	name: string;
	remoteOwner: string | null;
	remoteRepo: string | null;
}) => ({
	id: "p1",
	name: overrides.name,
	repoPath: "/tmp/x",
	defaultBranch: "main",
	color: null,
	remoteOwner: overrides.remoteOwner,
	remoteRepo: overrides.remoteRepo,
	remoteHost: null,
	status: "ready" as const,
	createdAt: new Date(),
	updatedAt: new Date(),
});

describe("resolveDisplayName", () => {
	test("returns local Project.name when remote owner+repo match", () => {
		const projects = [project({ name: "portal", remoteOwner: "slotsgames", remoteRepo: "portal" })];
		expect(
			resolveDisplayName({ owner: "slotsgames", repo: "portal" }, projects)
		).toBe("portal");
	});

	test("falls back to owner/repo when no project matches", () => {
		const projects = [project({ name: "portal", remoteOwner: "slotsgames", remoteRepo: "portal" })];
		expect(
			resolveDisplayName({ owner: "facebook", repo: "react" }, projects)
		).toBe("facebook/react");
	});

	test("falls back to owner/repo when projectsList is undefined", () => {
		expect(
			resolveDisplayName({ owner: "facebook", repo: "react" }, undefined)
		).toBe("facebook/react");
	});

	test("falls back to owner/repo when projectsList is empty", () => {
		expect(resolveDisplayName({ owner: "a", repo: "b" }, [])).toBe("a/b");
	});

	test("does not match a project with null remote fields", () => {
		const projects = [project({ name: "local", remoteOwner: null, remoteRepo: null })];
		expect(
			resolveDisplayName({ owner: "a", repo: "b" }, projects)
		).toBe("a/b");
	});
});

describe("findActivePRIdentifier", () => {
	test("returns the identifier when activeWorkspaceId matches a value", () => {
		const map = new Map<string, string>([
			["owner/repo#1", "ws-a"],
			["owner/repo#2", "ws-b"],
		]);
		expect(findActivePRIdentifier(map, "ws-b")).toBe("owner/repo#2");
	});

	test("returns null when activeWorkspaceId is empty", () => {
		const map = new Map([["owner/repo#1", "ws-a"]]);
		expect(findActivePRIdentifier(map, "")).toBeNull();
	});

	test("returns null when no entry matches", () => {
		const map = new Map([["owner/repo#1", "ws-a"]]);
		expect(findActivePRIdentifier(map, "ws-z")).toBeNull();
	});

	test("returns null for an empty map", () => {
		expect(findActivePRIdentifier(new Map(), "ws-a")).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test, verify it fails**

From `apps/desktop/`:

```bash
cd apps/desktop && bun test tests/pr-panel-helpers.test.ts
```

Expected: FAIL — the import resolves to a missing module.

- [ ] **Step 3: Create the implementation**

Write `apps/desktop/src/renderer/components/pr-panel-helpers.ts`:

```ts
/**
 * Pure helpers used by PullRequestsTab and PullRequestGroup.
 * Extracted as standalone functions so they can be unit-tested with bun:test
 * without needing a React rendering harness.
 */

interface ProjectLike {
	name: string;
	remoteOwner: string | null;
	remoteRepo: string | null;
}

/**
 * Given a PR group's owner+repo, return the local Project.name if the repo
 * is cloned locally, otherwise the `owner/repo` string.
 *
 * This makes the PRs tab show the same display name the Repos tab uses
 * (e.g., `portal` instead of `slotsgames/portal`) when the repo exists locally,
 * while still rendering useful info for remote-only PRs.
 */
export function resolveDisplayName(
	group: { owner: string; repo: string },
	projectsList: ProjectLike[] | undefined
): string {
	const project = projectsList?.find(
		(p) => p.remoteOwner === group.owner && p.remoteRepo === group.repo
	);
	return project?.name ?? `${group.owner}/${group.repo}`;
}

/**
 * Given a map of PR identifier → workspace ID, return the identifier whose
 * workspace ID matches `activeWorkspaceId`, or null if none match.
 *
 * Used to mark exactly one PR row as "active" in the PRs tab, mirroring the
 * way the Repos tab marks one workspace row as active.
 */
export function findActivePRIdentifier(
	workspaceIdMap: Map<string, string>,
	activeWorkspaceId: string
): string | null {
	if (!activeWorkspaceId) return null;
	for (const [identifier, wsId] of workspaceIdMap.entries()) {
		if (wsId === activeWorkspaceId) return identifier;
	}
	return null;
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
cd apps/desktop && bun test tests/pr-panel-helpers.test.ts
```

Expected: PASS — all 9 test cases green.

- [ ] **Step 5: Type-check + lint from repo root**

```bash
bun run type-check && bun run check
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/pr-panel-helpers.ts apps/desktop/tests/pr-panel-helpers.test.ts
git commit -m "feat(renderer): add pr-panel-helpers with display name + active-PR resolvers"
```

---

### Task 4: Add explicit `owner` / `repo` to grouped Map value in `PullRequestsTab.tsx`

**Files:**
- Modify: `apps/desktop/src/renderer/components/PullRequestsTab.tsx:606-671`

**Context:** The `grouped` Map currently stores `{ name, provider, items }` per repo. `resolveDisplayName` from Task 3 needs `owner` and `repo` fields to look up against `Project.remoteOwner` / `Project.remoteRepo`. Splitting the `repoKey` string at lookup time would work but is brittle (Bitbucket workspace names occasionally contain hyphens, slashes are stable but it's still parsing). Adding the fields explicitly is cleaner.

- [ ] **Step 1: Update the Map value type and population**

In `PullRequestsTab.tsx`, find the block starting around line 652 (`// Group by repo`). Replace it with:

```tsx
		// Group by repo
		const groups = new Map<
			string,
			{
				name: string;
				owner: string;
				repo: string;
				provider: "github" | "bitbucket";
				items: MergedPR[];
			}
		>();
		for (const pr of merged) {
			const existing = groups.get(pr.repoKey);
			if (existing) {
				existing.items.push(pr);
			} else {
				const [owner = "", repo = ""] = pr.repoKey.split("/");
				groups.set(pr.repoKey, {
					name: pr.repoDisplay,
					owner,
					repo,
					provider: pr.provider,
					items: [pr],
				});
			}
		}

		return groups;
```

The split is safe here because `repoKey` is constructed by us in this same function (lines 612 and 644) as `${owner}/${repo}` — there's exactly one slash and both halves are non-empty.

- [ ] **Step 2: Type-check**

```bash
bun run type-check
```

Expected: no errors. The Map's consumers (the `useEffect` at line 675 and the render at line 976) only read `group.items` and `group.name`, both still present.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "refactor(renderer): add owner/repo fields to grouped PR Map value"
```

---

### Task 5: Extract `RichPRItem` (and helpers) to `PullRequestItem.tsx`

**Files:**
- Create: `apps/desktop/src/renderer/components/PullRequestItem.tsx`
- Modify: `apps/desktop/src/renderer/components/PullRequestsTab.tsx:14-202`

**Context:** `PullRequestGroup` (Task 7) needs to import `RichPRItem`, but `RichPRItem` is currently inlined inside `PullRequestsTab.tsx`. This task moves `RichPRItem` and its tightly-coupled siblings (`ReviewerAvatar`, `EnrichmentSkeleton`, the `MergedPR` interface, the `initials` and `getHealthColor` helpers) to a new file. **No content or behavior changes** — pure mechanical move.

- [ ] **Step 1: Create the new file with the moved code**

Write `apps/desktop/src/renderer/components/PullRequestItem.tsx`:

```tsx
import type { BitbucketPullRequest } from "../../main/atlassian/bitbucket";
import type { GitHubPR } from "../../main/github/github";
import type { AgentAlert } from "../../shared/agent-events";
import type { GitHubPREnriched, GitHubReviewer } from "../../shared/github-types";
import { SwarmIndicator } from "./WorkspaceItem";

// ── Helpers ──────────────────────────────────────────────────────────────────

export function initials(name: string): string {
	return name
		.split(/[\s-_]+/)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? "")
		.join("");
}

export function getHealthColor(pr: MergedPR, enriched?: GitHubPREnriched): string {
	if (enriched?.mergeable === "CONFLICTING") return "#f85149";
	if (enriched?.ciState === "FAILURE") return "#f85149";
	if (pr.reviewDecision === "CHANGES_REQUESTED") return "#d29922";
	if (pr.reviewDecision === "APPROVED") return "#3fb950";
	return "#484848";
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ReviewerAvatar({ reviewer }: { reviewer: GitHubReviewer }) {
	const borderColor =
		reviewer.decision === "APPROVED"
			? "#3fb950"
			: reviewer.decision === "CHANGES_REQUESTED"
				? "#d29922"
				: "#484848";

	return (
		<div
			title={`${reviewer.login}: ${reviewer.decision ?? "pending"}`}
			className="flex size-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-[var(--text-tertiary)]"
			style={{
				border: `2px solid ${borderColor}`,
				backgroundColor: "var(--bg-elevated)",
			}}
		>
			{initials(reviewer.login)}
		</div>
	);
}

function EnrichmentSkeleton() {
	return (
		<div className="mt-0.5 flex items-center gap-1.5">
			<div className="h-3 w-12 animate-pulse rounded bg-[var(--bg-elevated)]" />
			<div className="h-3 w-8 animate-pulse rounded bg-[var(--bg-elevated)]" />
		</div>
	);
}

// ── Merged types ─────────────────────────────────────────────────────────────

export interface MergedPR {
	provider: "github" | "bitbucket";
	id: string;
	number: number | string;
	title: string;
	url: string;
	state: "open" | "merged" | "closed";
	isDraft: boolean;
	repoKey: string;
	repoDisplay: string;
	githubPR?: GitHubPR;
	bitbucketPR?: BitbucketPullRequest;
	reviewDecision?: GitHubPR["reviewDecision"];
	commentCount?: number;
}

// ── Rich PR List Item ────────────────────────────────────────────────────────

export function RichPRItem({
	pr,
	enriched,
	enrichmentLoading,
	isReviewer,
	agentAlert,
	projectsList,
	onClick,
	onContextMenu,
}: {
	pr: MergedPR;
	enriched: GitHubPREnriched | undefined;
	enrichmentLoading: boolean;
	isReviewer: boolean;
	identifier: string;
	agentAlert: AgentAlert | undefined;
	projectsList:
		| Array<{
				id: string;
				remoteOwner: string | null;
				remoteRepo: string | null;
				repoPath: string;
				defaultBranch: string;
		  }>
		| undefined;
	onClick: (e: React.MouseEvent) => void;
	onContextMenu?: (e: React.MouseEvent) => void;
}) {
	const sourceBranch = pr.githubPR?.branchName ?? pr.bitbucketPR?.source?.branch?.name ?? "";
	const targetBranch = enriched ? undefined : pr.bitbucketPR?.destination?.branch?.name;
	const project = pr.githubPR
		? projectsList?.find(
				(p) => p.remoteOwner === pr.githubPR!.repoOwner && p.remoteRepo === pr.githubPR!.repoName
			)
		: pr.bitbucketPR
			? projectsList?.find(
					(p) =>
						p.remoteOwner === pr.bitbucketPR!.workspace && p.remoteRepo === pr.bitbucketPR!.repoSlug
				)
			: undefined;
	const resolvedTarget = targetBranch ?? project?.defaultBranch ?? "main";
	const healthColor = getHealthColor(pr, enriched);

	return (
		<button
			type="button"
			onClick={onClick}
			onContextMenu={onContextMenu}
			className={`group flex w-full flex-col gap-0.5 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] ${
				isReviewer
					? "cursor-pointer text-[var(--text-secondary)]"
					: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
			}`}
			title={`${pr.repoDisplay}#${pr.number}: ${pr.title}`}
		>
			{/* Row 1: Title + SwarmIndicator + health dot + PR number */}
			<div className="flex items-center gap-1">
				<span className="min-w-0 flex-1 truncate text-[12px] leading-tight">{pr.title}</span>
				{agentAlert && <SwarmIndicator alert={agentAlert} />}
				<span
					className="size-1.5 shrink-0 rounded-full"
					style={{ backgroundColor: healthColor }}
					title={
						healthColor === "#3fb950"
							? "Approved"
							: healthColor === "#d29922"
								? "Changes requested"
								: healthColor === "#f85149"
									? "Conflicts or CI failure"
									: "Pending review"
					}
				/>
				<span className="shrink-0 font-mono text-[10px] text-[var(--text-quaternary)]">
					#{pr.number}
				</span>
			</div>

			{/* Row 2: Branch info */}
			<div className="flex items-center gap-1 text-[10px] text-[var(--text-quaternary)]">
				<span className="min-w-0 truncate font-mono">{sourceBranch}</span>
				<span className="shrink-0">{">"}</span>
				<span className="shrink-0 truncate font-mono">{resolvedTarget}</span>
			</div>

			{/* Row 3: Author + Reviewers */}
			{(enriched || enrichmentLoading) && (
				<div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--text-quaternary)]">
					{enriched ? (
						<>
							<span className="shrink-0 text-[8px] uppercase tracking-[0.05em] text-[var(--text-quaternary)] opacity-50">
								by
							</span>
							<div
								className="flex size-4 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-[var(--text-tertiary)]"
								style={{ backgroundColor: "var(--bg-overlay)" }}
								title={enriched.author}
							>
								{initials(enriched.author)}
							</div>
							<span className="truncate">{enriched.author}</span>

							{enriched.reviewers.length > 0 && <span className="flex-1" />}

							<div className="flex items-center gap-0.5">
								{enriched.reviewers.map((r) => (
									<ReviewerAvatar key={r.login} reviewer={r} />
								))}
							</div>
						</>
					) : (
						<EnrichmentSkeleton />
					)}
				</div>
			)}
		</button>
	);
}
```

- [ ] **Step 2: Remove the moved code from `PullRequestsTab.tsx`**

Open `apps/desktop/src/renderer/components/PullRequestsTab.tsx`. Delete:

- Lines ~14–22: the `initials` helper.
- Lines ~24–30: the `getHealthColor` helper.
- Lines ~34–53: `function ReviewerAvatar`.
- Lines ~56–63: `function EnrichmentSkeleton`.
- Lines ~67–81: the `interface MergedPR`.
- Lines ~85–202: `function RichPRItem`.

After the deletes, the file's top-level structure should jump from imports straight to `// ── Context Menu ──` and `function PRContextMenu`.

- [ ] **Step 3: Update imports in `PullRequestsTab.tsx`**

The imports section at the top of `PullRequestsTab.tsx` currently includes types and components only used by the moved code. Replace the existing import block (lines 1–12) with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitHubPREnriched, PRContext } from "../../shared/github-types";
import { useAgentAlertStore } from "../stores/agent-alert-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { ConnectBanner } from "./ConnectBanner";
import { CreateWorktreeFromPRModal, type LinkablePR } from "./CreateWorktreeFromPRModal";
import { type MergedPR, RichPRItem } from "./PullRequestItem";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";
```

If the type-check in the next step reports any other unused or missing imports (e.g., `BitbucketPullRequest`, `GitHubPR`, `AgentAlert`, `GitHubReviewer`, `SwarmIndicator`), remove or re-add them as needed — they may still be referenced by code elsewhere in `PullRequestsTab.tsx` (`handleUnlinkedPR`, `triggerReviewWithCtx`, etc.).

- [ ] **Step 4: Type-check**

```bash
bun run type-check
```

Expected: no errors. If there are errors:
- "Cannot find name `MergedPR`" → confirm the import on line ~9.
- "Cannot find name `getPrIdentifier`" → that helper stays in `PullRequestsTab.tsx`, no change needed.
- "Cannot find name `initials`/`getHealthColor`" anywhere outside the moved block → those helpers are no longer used outside `PullRequestItem.tsx`, so the error means stale references remain. Search and remove.

- [ ] **Step 5: Lint + format**

```bash
bun run check
```

- [ ] **Step 6: Manual visual verification**

```bash
bun run dev
```

Open the PRs tab. The PR rows should look exactly the same as before — title, branch info, author, reviewer avatars, status dot, agent indicator. Click a PR; it should still open or create the review workspace.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestItem.tsx apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "refactor(renderer): extract RichPRItem to its own file"
```

---

### Task 6: Add `isActive` and `isInActiveGroup` props to `RichPRItem`

**Files:**
- Modify: `apps/desktop/src/renderer/components/PullRequestItem.tsx`

**Context:** Mirror `WorkspaceItem`'s active-row treatment (`apps/desktop/src/renderer/components/WorkspaceItem.tsx:338-352`): when active, the row gets a dark `#17171e` bg, rounded-right corners, a left accent stripe at 50% opacity, and a slight padding shift to align under the group header. The padding base also changes from `px-2.5` to `pl-[22px] pr-3 py-[7px]` to match how workspace rows sit under a project header.

- [ ] **Step 1: Update the props interface**

In `apps/desktop/src/renderer/components/PullRequestItem.tsx`, find the `function RichPRItem({ ... })` props block. Add `isActive` and `isInActiveGroup` to the destructured props and the type:

```tsx
export function RichPRItem({
	pr,
	enriched,
	enrichmentLoading,
	isReviewer,
	isActive,
	isInActiveGroup,
	agentAlert,
	projectsList,
	onClick,
	onContextMenu,
}: {
	pr: MergedPR;
	enriched: GitHubPREnriched | undefined;
	enrichmentLoading: boolean;
	isReviewer: boolean;
	isActive: boolean;
	isInActiveGroup: boolean;
	identifier: string;
	agentAlert: AgentAlert | undefined;
	projectsList:
		| Array<{
				id: string;
				remoteOwner: string | null;
				remoteRepo: string | null;
				repoPath: string;
				defaultBranch: string;
		  }>
		| undefined;
	onClick: (e: React.MouseEvent) => void;
	onContextMenu?: (e: React.MouseEvent) => void;
}) {
```

- [ ] **Step 2: Update the root button's className and add `style`**

Replace the `<button>` opening tag (currently uses a single `className` template literal) with:

```tsx
		<button
			type="button"
			onClick={onClick}
			onContextMenu={onContextMenu}
			className={[
				"group flex w-full flex-col gap-0.5 border-none pr-3 py-[7px] text-left text-[12px] cursor-pointer",
				"transition-all duration-[120ms]",
				isActive
					? "rounded-r-[6px] rounded-l-none bg-[#17171e] hover:bg-[#1c1c24]"
					: "rounded-[6px] bg-transparent hover:bg-[var(--bg-elevated)]",
				isActive && isInActiveGroup ? "pl-[20px]" : "pl-[22px]",
				isActive
					? "text-[var(--text)]"
					: isReviewer
						? "text-[var(--text-secondary)]"
						: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
			].join(" ")}
			style={
				isActive && isInActiveGroup
					? { borderLeft: "2px solid rgba(10, 132, 255, 0.5)", marginLeft: -2 }
					: undefined
			}
			title={`${pr.repoDisplay}#${pr.number}: ${pr.title}`}
		>
```

The body of the button (the three rows) is unchanged.

- [ ] **Step 3: Type-check**

```bash
bun run type-check
```

Expected: error in `PullRequestsTab.tsx` because `RichPRItem` is now called without the new required props. We'll fix this in Task 8 — for now, temporarily silence it by adding `isActive={false}` and `isInActiveGroup={false}` at the existing call site (around line 1037, now relocated after Task 5):

```tsx
											<RichPRItem
												key={pr.id}
												pr={pr}
												enriched={enriched}
												enrichmentLoading={enrichmentLoading}
												isReviewer={isReviewer}
												isActive={false}
												isInActiveGroup={false}
												identifier={identifier}
												agentAlert={agentAlert}
												projectsList={projectsList}
												onClick={(e) => handlePRClick(pr, e)}
												onContextMenu={handleContextMenu}
											/>
```

Re-run `bun run type-check`. Expected: clean.

- [ ] **Step 4: Lint + format**

```bash
bun run check
```

- [ ] **Step 5: Manual visual check**

```bash
bun run dev
```

Open the PRs tab. PR rows should now sit slightly more indented (left padding 22px instead of the previous 10px). The hover bg still works. No active row highlight yet — that comes in Task 8 when we wire `activePRIdentifier` through.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestItem.tsx apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "feat(renderer): add isActive/isInActiveGroup props to RichPRItem"
```

---

### Task 7: Create `PullRequestGroup` component

**Files:**
- Create: `apps/desktop/src/renderer/components/PullRequestGroup.tsx`

**Context:** Wraps `RepoGroup` with PR-specific concerns: count badge, display-name resolution, derived "is this group active" check, and the children mapping over `RichPRItem`.

`PullRequestGroup` does not own state — it receives `activePRIdentifier`, `isCollapsed`, the data maps, and the click handlers from its parent (`PullRequestsTab`). This keeps it pure and easy to reason about.

- [ ] **Step 1: Create the file**

Write `apps/desktop/src/renderer/components/PullRequestGroup.tsx`:

```tsx
import type { Project } from "../../main/db/schema";
import type { AgentAlert } from "../../shared/agent-events";
import type { GitHubPREnriched } from "../../shared/github-types";
import { type MergedPR, RichPRItem } from "./PullRequestItem";
import { resolveDisplayName } from "./pr-panel-helpers";
import { RepoGroup } from "./RepoGroup";

interface PullRequestGroupProps {
	repoKey: string;
	owner: string;
	repo: string;
	prs: MergedPR[];
	isCollapsed: boolean;
	onToggleCollapse: () => void;
	activePRIdentifier: string | null;
	getPrIdentifier: (pr: MergedPR) => string;

	// Forwarded into each RichPRItem
	enrichmentMap: Map<string, GitHubPREnriched>;
	enrichmentLoading: boolean;
	agentAlerts: Record<string, AgentAlert | undefined>;
	workspaceIdMap: Map<string, string>;
	projectsList: Project[] | undefined;
	onPRClick: (pr: MergedPR, e: React.MouseEvent) => void;
	onPRContextMenu: (pr: MergedPR, e: React.MouseEvent) => void;
}

export function PullRequestGroup({
	owner,
	repo,
	prs,
	isCollapsed,
	onToggleCollapse,
	activePRIdentifier,
	getPrIdentifier,
	enrichmentMap,
	enrichmentLoading,
	agentAlerts,
	workspaceIdMap,
	projectsList,
	onPRClick,
	onPRContextMenu,
}: PullRequestGroupProps) {
	const displayName = resolveDisplayName({ owner, repo }, projectsList);
	const isGroupActive =
		activePRIdentifier !== null && prs.some((pr) => getPrIdentifier(pr) === activePRIdentifier);

	return (
		<RepoGroup
			name={displayName}
			isActive={isGroupActive}
			isExpanded={!isCollapsed}
			onToggle={onToggleCollapse}
			rightContent={
				<span className="text-[11px] tabular-nums text-[var(--text-quaternary)]">
					{prs.length}
				</span>
			}
		>
			<div className="flex flex-col">
				{prs.map((pr) => {
					const identifier = getPrIdentifier(pr);
					const isReviewer =
						pr.githubPR?.role === "reviewer" || pr.provider === "bitbucket";
					const enriched = enrichmentMap.get(identifier);
					const knownWorkspaceId = workspaceIdMap.get(identifier);
					const agentAlert = knownWorkspaceId ? agentAlerts[knownWorkspaceId] : undefined;
					const isActive = activePRIdentifier === identifier;

					return (
						<RichPRItem
							key={pr.id}
							pr={pr}
							enriched={enriched}
							enrichmentLoading={enrichmentLoading}
							isReviewer={isReviewer}
							isActive={isActive}
							isInActiveGroup={isGroupActive}
							identifier={identifier}
							agentAlert={agentAlert}
							projectsList={projectsList}
							onClick={(e) => onPRClick(pr, e)}
							onContextMenu={(e) => onPRContextMenu(pr, e)}
						/>
					);
				})}
			</div>
		</RepoGroup>
	);
}
```

Notes:
- The `enrichmentMap` lookup uses `identifier` directly. The current code in `PullRequestsTab.tsx` (lines 1013–1019) builds a separate `enrichmentKey` that's structurally identical to `identifier` for both providers — both `${owner}/${repo}#${number}`. We collapse them to a single `identifier` here. If you discover a discrepancy (e.g., a Bitbucket key uses `repoSlug` but the enrichment cache keys by something else), align the cache keys to use `identifier` consistently in Task 8.
- `agentAlerts` is typed as `Record<string, AgentAlert | undefined>` to match the indexed-access pattern in the original code (`agentAlerts[knownWorkspaceId]`).

- [ ] **Step 2: Type-check**

```bash
bun run type-check
```

Expected: no errors in the new file. There may still be errors in `PullRequestsTab.tsx` that we'll resolve in Task 8.

- [ ] **Step 3: Lint + format**

```bash
bun run check
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestGroup.tsx
git commit -m "feat(renderer): add PullRequestGroup component"
```

---

### Task 8: Wire `PullRequestsTab.tsx` to use `PullRequestGroup`

**Files:**
- Modify: `apps/desktop/src/renderer/components/PullRequestsTab.tsx`

**Context:** Replace the inlined group rendering loop (currently lines ~975–1056) with `PullRequestGroup` invocations. Derive `activePRIdentifier` once near the top of the component using `findActivePRIdentifier`. Match the outer container's spacing to the Repos tab (`flex flex-col gap-2 px-2 pt-2`).

- [ ] **Step 1: Add imports**

In `PullRequestsTab.tsx`, add to the import block at the top of the file (alongside the existing imports):

```tsx
import { findActivePRIdentifier } from "./pr-panel-helpers";
import { PullRequestGroup } from "./PullRequestGroup";
```

- [ ] **Step 2: Read `activeWorkspaceId` and derive `activePRIdentifier`**

The component already calls `useTabStore()` (line 557) — the result is used as `store.setActiveWorkspace`, etc. Add a separate selector subscription for `activeWorkspaceId` so the component re-renders when the active workspace changes. Add this just below the existing `const store = useTabStore();` (around line 557):

```tsx
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
```

Then add the derivation. Place this after `grouped` is defined (after the `useMemo` block ending at line 671):

```tsx
	const activePRIdentifier = useMemo(
		() => findActivePRIdentifier(workspaceIdMapRef.current, activeWorkspaceId),
		// workspaceIdMapRef is mutated as a ref, so React doesn't track it as a dep —
		// recompute whenever the active workspace changes (which is the only event that
		// can change the answer).
		[activeWorkspaceId]
	);
```

- [ ] **Step 3: Build a `getPrIdentifier` reference suitable for passing to children**

`getPrIdentifier` is currently a function declaration inside the component (line 560). Wrap it in `useCallback` so it has a stable identity when passed to `PullRequestGroup`:

Replace lines 560–568 (the `function getPrIdentifier(pr: MergedPR): string { ... }` block) with:

```tsx
	const getPrIdentifier = useCallback((pr: MergedPR): string => {
		if (pr.provider === "github" && pr.githubPR) {
			return `${pr.githubPR.repoOwner}/${pr.githubPR.repoName}#${pr.githubPR.number}`;
		}
		if (pr.provider === "bitbucket" && pr.bitbucketPR) {
			return `${pr.bitbucketPR.workspace}/${pr.bitbucketPR.repoSlug}#${pr.bitbucketPR.id}`;
		}
		return pr.id;
	}, []);
```

- [ ] **Step 4: Replace the group rendering block**

Find the block currently at lines ~975–1056 — it begins with `<div className="flex flex-col">` and ends after the `.map([...grouped.entries()]...)` close. Replace the entire block with:

```tsx
				<div className="flex flex-col gap-2 px-2 pt-2">
					{[...grouped.entries()].map(([repoKey, group]) => (
						<PullRequestGroup
							key={repoKey}
							repoKey={repoKey}
							owner={group.owner}
							repo={group.repo}
							prs={group.items}
							isCollapsed={collapsedGroups.has(repoKey)}
							onToggleCollapse={() => toggleGroup(repoKey)}
							activePRIdentifier={activePRIdentifier}
							getPrIdentifier={getPrIdentifier}
							enrichmentMap={enrichmentMap}
							enrichmentLoading={
								(reviewerPRsForEnrichment.length > 0 && enrichmentQuery.isLoading) ||
								(bitbucketPRsForEnrichment.length > 0 && bbEnrichmentQuery.isLoading)
							}
							agentAlerts={agentAlerts}
							workspaceIdMap={workspaceIdMapRef.current}
							projectsList={projectsList}
							onPRClick={handlePRClick}
							onPRContextMenu={(pr, e) => {
								e.preventDefault();
								const identifier = getPrIdentifier(pr);
								const knownWorkspaceId = workspaceIdMapRef.current.get(identifier);
								setContextMenu({
									position: { x: e.clientX, y: e.clientY },
									url: pr.url,
									workspaceId: knownWorkspaceId,
									identifier,
								});
							}}
						/>
					))}
				</div>
```

- [ ] **Step 5: Verify there are no orphaned references**

The deleted block referenced `enrichmentKey`, the inline `handleContextMenu`, and `enriched` lookups — all of those are now inside `PullRequestGroup`. Search the file for stray references:

```bash
grep -n "enrichmentKey\|handleContextMenu" apps/desktop/src/renderer/components/PullRequestsTab.tsx
```

Expected: no matches. If there are any, they're stale and can be deleted.

- [ ] **Step 6: Type-check**

```bash
bun run type-check
```

Expected: clean. Common errors and fixes:
- `enrichmentMap` not in scope → it's the `useMemo` result around line ~750. If named differently in the current file, update the prop name in the JSX.
- `agentAlerts` typed as `Record<string, AgentAlert>` but `PullRequestGroup` expects `Record<string, AgentAlert | undefined>` → this is structurally compatible; if TS complains, cast at the call site: `agentAlerts={agentAlerts as Record<string, AgentAlert | undefined>}`.

- [ ] **Step 7: Lint + format**

```bash
bun run check
```

- [ ] **Step 8: Run the existing test suite**

```bash
cd apps/desktop && bun test
```

Expected: all tests pass, including the new `pr-panel-helpers.test.ts` from Task 3. No tests should have regressed.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/components/PullRequestsTab.tsx
git commit -m "feat(renderer): wire PullRequestsTab to use PullRequestGroup"
```

---

### Task 9: End-to-end manual visual verification

**Files:** none (verification only).

**Context:** The whole reason this redesign exists is visual. We have no React Testing Library, so the final acceptance is a human eye on the running app.

- [ ] **Step 1: Run the app**

```bash
bun run dev
```

- [ ] **Step 2: Verify the Repos tab is unchanged**

1. Click the **Repos** tab in the sidebar.
2. Each project renders with the same look as before this work: bold name, chevron, hover to elevated bg, gradient + accent stripe when its workspace is active.
3. Expand/collapse a project — chevron rotates, workspaces appear/disappear.
4. Switch active workspace — the project header gradient + stripe appear when an active workspace is inside it.
5. Right-click a project — the context menu appears.
6. Click `+` on an active project — the create-worktree modal opens.

If anything is off, the regression came from Task 2. Diff `ProjectItem.tsx` against the previous commit and re-align.

- [ ] **Step 3: Verify the PRs tab matches the Repos tab styling**

1. Click the **PRs** tab.
2. Each repo group has a 13px semibold header (not the old 11px uppercase) with a count badge on the right.
3. Hover an inactive group header — bg goes to `--bg-elevated`.
4. Click a group header — chevron rotates 90°, the PR rows expand/collapse.
5. PR rows are indented `~22px` from the left, sitting under the group header at the same indent workspace rows use under a project header.

- [ ] **Step 4: Verify the active highlight**

1. From the PRs tab, click any PR row to open its review workspace. You'll be navigated to the workspace.
2. Click back to the **PRs** tab.
3. The group containing that PR should now have the gradient + 2px accent stripe (only if the group is expanded — collapsed groups show only the brighter text color).
4. The specific PR row inside that group should have the dark `#17171e` bg, rounded right corners, and a 50% accent stripe on its left edge.
5. Click a different PR in a different repo. The active treatment should jump to the new group + new row; the old group should return to inactive.

- [ ] **Step 5: Verify display name resolution**

1. If you have at least one PR for a repo that's cloned locally, the group header should show the local `Project.name` (e.g., `portal`) — the same string the Repos tab shows.
2. If you have a PR for a repo that's NOT cloned locally, the group header should show `owner/repo` (e.g., `slotsgames/portal`).
3. Both kinds of groups should coexist without visual glitches.

- [ ] **Step 6: Verify collapse persistence**

1. Collapse a group, refresh the app (`Cmd+R`), and verify the group is still collapsed. (The collapsed state is persisted via `tickets.setCollapsedGroups` — this is unchanged behavior.)

- [ ] **Step 7: Verify context menu still works**

1. Right-click a PR row. The context menu should still appear with "Open in browser" and any other items.

- [ ] **Step 8: Final commit (if any visual fixes were needed)**

If Steps 2–7 surfaced minor regressions and you fixed them, commit:

```bash
git add -A
git commit -m "fix(renderer): post-redesign visual polish"
```

If everything was clean, no commit needed.

- [ ] **Step 9: Push the branch**

```bash
git push -u origin redesign-pr-panel
```

---

## Acceptance Criteria

- The PRs tab and the Repos tab render their group chrome through the same `RepoGroup` component — visually byte-identical.
- A PR with a locally-cloned repo shows the same display name in both tabs.
- A PR with no local clone falls back to `owner/repo` and still renders cleanly.
- The currently-active workspace's parent PR (and its parent group, when expanded) gets the active treatment in the PRs tab; clicking another PR moves the highlight.
- All existing PR-tab behaviors are preserved: collapse persistence, click-to-open-workspace, context menu, agent alert indicator, enrichment skeleton, reviewer avatars, status dot.
- `bun run type-check`, `bun run check`, and `bun test` all pass.
- The Repos tab is visually unchanged.
