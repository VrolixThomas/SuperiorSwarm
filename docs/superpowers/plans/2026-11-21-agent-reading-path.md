# Agent Reading Path (PR Review) Implementation Plan

> **Implementation clarification (2026-11-21):** The user confirmed this replaces the current PR review workflow. `ReviewWorkspace` is the default review entry point, not a preference-gated preview. References below to the preview flag/flag-off acceptance describe the original rollout proposal and are superseded. Existing submit, draft, reply, resolve, and terminal behavior must carry over. Path mapping and Ask remain frontend-only in this increment: fixtures require explicit opt-in, and live PRs must clearly report that those backends are unavailable rather than display sample agent output.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend for reviewing a PR along an agent-authored reading path: path rail grouped by entry point, file diffs as the source of truth, tests under their code, context files, inline findings and threads, Ask agent panel, Files view, All PRs / Next PR — fitting a 1512×945 window.

**Architecture:** A new `ReviewWorkspace` shell renders in place of the current `ActiveReviewModeShell` when the `reviewPathLayout` preference is on (default off, so the old shell stays the fallback). Both shells share one data/callback hook extracted from `ReviewModeShell.tsx`. The path comes from `useReviewPath()`, which in this increment is backed by typed fixtures (including a simulated live mapping); the backend/MCP increment later swaps its implementation without touching components. All other data (PR details, threads, AI drafts, viewed state, file contents, PR lists) keeps using the existing tRPC routers.

**Tech Stack:** Electron + React 19 + TypeScript, Tailwind v4 with CSS-variable tokens, zustand, tRPC over IPC, Monaco (`DiffEditor`), bun test.

**Spec:** `docs/superpowers/specs/2026-11-21-agent-reading-path-design.md` — read it, and open the mock for the screen you are building, before starting any task.
**Mocks:** `docs/superpowers/specs/assets/2026-11-21-agent-reading-path/NN-*.png` (what it should look like) and `NN-*.html` (exact sizes, spacing and colours; open in a browser and inspect). Mock hex values map to tokens via the table in spec §8 — never copy hex literals into components.

**Implementation handoff:** [2026-11-21-agent-reading-path-handoff.md](2026-11-21-agent-reading-path-handoff.md) — frontend replacement implemented and validated; backend boundaries listed explicitly.

## Global Constraints

- Biome formatting: tabs, line width 100, double quotes, semicolons, ES5 trailing commas. Run `bun run check` before every commit.
- Never use `npm`/`yarn`; always `bun`. Never add `Co-Authored-By` trailers. Never bypass pre-commit hooks.
- Commands run from `apps/desktop/` unless stated otherwise. Tests: `bun test tests/<file>`. The full suite is flaky locally (see CLAUDE.md); run the files you touch plus the ones listed per task.
- Colours, spacing and radii come from `apps/desktop/src/renderer/styles.css` variables only. No new colours, no hex literals in components. Text never uses `--text-quaternary`.
- **No inset / left-border accent on rows** (`shadow-[inset_2px_0_0_…]`, `border-l-2 border-[var(--accent)]`). Active = `bg-[var(--bg-overlay)]`.
- Font-size floor 11px. Mono only for paths, line refs and code.
- Cross-process/shared types go in `apps/desktop/src/shared/`.
- New files stay under ~300 lines; split when they grow.
- No backend changes except the additive optional type fields in Task 1. No MCP changes. No new tRPC procedures.
- `docs/` is gitignored; doc commits need `git add -f`.
- The graphify post-commit hook may print a rebuild error — ignore it.
- Keep the old shell working at every commit (flag off = today's behaviour).

## File Structure (target)

```
apps/desktop/src/shared/
  review-path-types.ts                 NEW  contract (spec §9)
  github-types.ts                      EDIT optional isOutdated/originalLine, category
apps/desktop/src/renderer/
  lib/
    review-path-model.ts               NEW  pure: numbering, rail order, coverage, counts, tree, stale
    review-path-fixtures.ts            NEW  PR #129 fixture + mapping frames (matches mocks)
    review-path-source.ts              NEW  useReviewPath(prCtx, details) – fixture-backed for now
    review-queue.ts                    NEW  pure: needs-review queue, next/prev
    open-pr-review.ts                  NEW  extracted from PullRequestsTab.openPRWorkspace
    review-keymap.ts                   EDIT f, /, t, ⌘↓/⌘↑, Esc layering
  stores/
    review-mode-store.ts               EDIT railMode, panel, queueOpen, overviewOpen, askAnchor
    review-path-settings-store.ts      NEW  ReviewPathSettings + reviewPathLayout (localStorage, like sidebar-bands.ts)
  components/review-mode/
    ReviewModeShell.tsx                EDIT render ReviewWorkspace when flag on; use shared hook
    useReviewWorkspaceData.ts          NEW  data + ThreadCallbacks extracted from ReviewModeShell
    ReviewWorkspace.tsx                NEW  new shell
    HintBar.tsx                        NEW
    top-bar/ReviewTopBar.tsx           NEW
    top-bar/MappingPill.tsx            NEW
    rail/ReviewRail.tsx                NEW
    rail/RailHeader.tsx                NEW
    rail/MapPathCard.tsx               NEW
    rail/PathRail.tsx                  NEW
    rail/RailRows.tsx                  NEW  StepRow, TestRow, ContextRow, SkeletonRow
    rail/FilesRail.tsx                 NEW
    step/StepHeader.tsx                NEW
    step/StepDiff.tsx                  NEW  diff for one file (logic moved out of ChangesView)
    step/ContextFileView.tsx           NEW
    hooks/useFocusDecorations.ts       NEW
    hooks/useSelectionActions.ts       NEW
    panel/SidePanel.tsx                NEW
    panel/ThreadsTab.tsx               NEW
    panel/AskTab.tsx                   NEW
    panel/useAskAgent.ts               NEW  fixture responder for now
    thread/FindingCard.tsx             NEW
    thread/ResolvedThreadRow.tsx       NEW
    thread/AgentNoteRow.tsx            NEW
    queue/AllPRsDrawer.tsx             NEW
  components/settings/AIReviewerSettings.tsx   EDIT "New review layout (preview)" + auto-map toggles
apps/desktop/tests/
  review-path-model.test.ts            NEW
  review-path-fixtures.test.ts         NEW
  review-path-source.test.ts           NEW
  review-queue.test.ts                 NEW
  review-path-settings-store.test.ts   NEW
  review-mode-store.test.ts            EDIT
  review-keymap.test.ts                EDIT
  review-workspace-rail.test.tsx       NEW  renderer test (pattern: tests/diff-markdown-preview.test.tsx)
  review-workspace-panel.test.tsx      NEW
```

## Execution order and lanes

```
Phase 0 (one agent, sequential): T1 → T2 → T3 → T4 → T5
Phase 1 (parallel after T5):
  Lane A  top bar + queue        T6 → T7
  Lane B  rail                   T8 → T9
  Lane C  main column            T10 → T11
  Lane D  threads/findings/ask   T12 → T13 → T14
Phase 2 (one agent): T15 → T16
```

Lanes only touch their own files. Shared files (`ReviewWorkspace.tsx`, `review-mode-store.ts`, `review-keymap.ts`) are owned by Phase 0 / Phase 2; lanes request changes to them in their handoff instead of editing them, except the one-line mount points listed in their task.

---

## Phase 0 — Foundations

### Task 1: Shared types and fixtures

**Files:** `src/shared/review-path-types.ts` (new), `src/shared/github-types.ts` (edit), `src/renderer/lib/review-path-fixtures.ts` (new), `tests/review-path-fixtures.test.ts` (new)

- [ ] Copy the types from spec §9 verbatim into `review-path-types.ts`.
- [ ] Add optional `isOutdated?: boolean; originalLine?: number | null` to `GitHubReviewThread` and `category?: string` to `AIDraftThread`. No other type changes.
- [ ] Build `PR129_PATH: ReviewPath` matching mocks 03/05/08/09: entries "Submit a review" (SubmitReviewPopover.tsx, pr-review-submit.ts + test, ai-review.ts, review-publisher.ts + test, context git-provider.ts) and "Open a PR for review" (GitHubPRList.tsx, pr-review-nav.ts, tab-store.ts + test, review-mode-store.ts + review-mode-store/review-mode-nav tests); otherFiles CLAUDE.md, bun.lock, styles.css, the July plan doc. Notes and focus ranges as in the mocks (ai-review.ts focus RIGHT 385–393; review-publisher.ts RIGHT 115–119; git-provider.ts RIGHT 9–13).
- [ ] Export `PR129_MAPPING_FRAMES: ReviewPath[]` (status `mapping`, progressively more steps, final frame = `PR129_PATH` with status `ready`), plus `PR129_THREAD_NOTES` and `PR129_ASK_SAMPLE: AskMessage[]` from mocks 04/09.
- [ ] Test: every file of a fixture `details.files` list appears exactly once across changed steps, changed tests and otherFiles; step ids unique; focus ranges have `startLine <= endLine`.
- [ ] Run `bun test tests/review-path-fixtures.test.ts`, `bun run check`, commit `feat(review-path): shared contract and fixtures`.

### Task 2: Pure path model

**Files:** `src/renderer/lib/review-path-model.ts` (new), `tests/review-path-model.test.ts` (new)

Functions (all pure, no React):
- `numberSteps(path) → Map<stepId, number>` — changed steps 1…N across entries; context steps and tests unnumbered.
- `railItems(path | null, files, mode: "path" | "files") → RailItem[]` — the single ordered list used by the rail **and** j/k. Path order: entry → step → its tests → its context steps → next step … → otherFiles (+ any changed file missing from the path, appended). Files order: provider order grouped by folder (`folderGroups(files)`).
- `coverage(path, files) → { missing: string[]; duplicated: string[] }`.
- `viewedProgress(files, viewedSet) → { viewed, total }` — counts changed files only.
- `countsByPath(threads: UnifiedThread[]) → Map<path, { openThreads: number; pendingFindings: number }>` — open = non-AI threads with `!isResolved`; findings = AI drafts with `status === "pending"`.
- `isStale(path, headCommitOid) → boolean`; `stepForPath(path, filePath)`; `stepLabel(path, item, mode)` → "Step 3 of 8" / "Step 1" while mapping / "File 2 of 17" / "Context".

- [ ] Write failing tests first for each function using the T1 fixture (ordering, numbering with context steps in between, missing-file append, duplicated detection, files grouping order, viewed excludes context, counts, stale, labels).
- [ ] Implement, run `bun test tests/review-path-model.test.ts`, commit `feat(review-path): pure path model`.

### Task 3: Path source and settings

**Files:** `src/renderer/lib/review-path-source.ts`, `src/renderer/stores/review-path-settings-store.ts`, `tests/review-path-source.test.ts`, `tests/review-path-settings-store.test.ts` (all new)

- [ ] `review-path-settings-store.ts`: zustand store holding `ReviewPathSettings` + `reviewPathLayout: boolean` (default false), persisted to `localStorage` the same way `stores/sidebar-bands.ts` does (guard for missing storage).
- [ ] `useReviewPath(prCtx, details)` returns `{ path, status, start({ agentId, alsoReview }), stop(), retry(), addContextStep(entryId, afterStepId, path), removeContextStep(stepId) }`. Implementation for now: a small in-memory registry keyed by `formatPrIdentifier(prCtx)`; PR #129 resolves to the fixture, others to `status: "none"`. `start()` plays `PR129_MAPPING_FRAMES` on a timer (pure reducer `applyMappingFrame(state, frame)` exported for tests); `stop()` keeps the placed steps and sets `failed`/`ready` accordingly. User context steps are stored in the registry with `addedBy: "user"`.
- [ ] Keep the hook's return type stable and documented at the top of the file: the backend increment replaces only the internals.
- [ ] Tests: settings persistence round-trip; `applyMappingFrame` never reorders already placed steps; add/remove context step; unknown PR → `none`.
- [ ] Commit `feat(review-path): fixture-backed path source and settings`.

### Task 4: Store and keymap

**Files:** `src/renderer/stores/review-mode-store.ts`, `src/renderer/lib/review-keymap.ts`, `tests/review-mode-store.test.ts`, `tests/review-keymap.test.ts` (edits)

- [ ] Store: add `railMode: "path" | "files" | null` (null = use settings default), `panel: null | "threads" | "ask"`, `queueOpen: boolean`, `overviewOpen: boolean`, `askAnchor: AskMessage["anchor"] | null`, with setters. `close()` resets them.
- [ ] Keymap: new actions `toggle-rail-mode` (`f`), `ask-agent` (`/`), `open-threads` (`t`), `next-pr` (⌘↓), `prev-pr` (⌘↑) — only when a `layout: "path"` option is passed so the old shell's mapping is unchanged. ⌘↓/⌘↑ must be checked before the existing "ignore all meta keys" early return.
- [ ] Esc layering helper `escapeTarget(state) → "composer" | "panel" | "queue" | "overview" | "leave"` (pure, tested).
- [ ] Extend both test files; run them; commit `feat(review-path): store state and keymap`.

### Task 5: Shell switch and shared data hook

**Files:** `components/review-mode/useReviewWorkspaceData.ts` (new), `ReviewModeShell.tsx` (edit), `ReviewWorkspace.tsx` (new), `AIReviewerSettings.tsx` (edit)

- [ ] Move the data/mutation/callback block of `ActiveReviewModeShell` (from `useReviewData` through the `callbacks` memo and `handleSubmitted`) into `useReviewWorkspaceData(workspaceId, prCtx)` without behaviour changes. The old shell consumes it.
- [ ] `ReviewModeShell`: when `useReviewPathSettingsStore(s => s.reviewPathLayout)` is true render `<ReviewWorkspace active={active} />`, else the existing shell.
- [ ] `ReviewWorkspace` skeleton: 44px top bar placeholder, rail placeholder (288px), main placeholder, hint bar placeholder — layout only, using tokens.
- [ ] Settings: add "New review layout (preview)" toggle and the two auto-map/also-review toggles (bound to the settings store) in `AIReviewerSettings.tsx`.
- [ ] Verify the old shell is unchanged: `bun test tests/review-mode-store.test.ts tests/review-keymap.test.ts tests/review-mode-nav.test.ts tests/pr-review-threads.test.ts`. Commit `feat(review-path): workspace shell behind preference`.

---

## Phase 1 — UI lanes

### Task 6 (Lane A): Top bar — mock 01–09 top edge

**Files:** `top-bar/ReviewTopBar.tsx`, `top-bar/MappingPill.tsx`; mount point: one line in `ReviewWorkspace.tsx`

- [ ] Left: macOS inset traffic-light spacing (match the existing header's `app-drag`/`app-no-drag` handling), **All PRs** button with count (opens queue), divider, PR title (13/500, click → `overviewOpen`), `#number`, branch (mono 11).
- [ ] Right: status slot (`MappingPill` while mapping, else existing `AgentStatusChip`), **Next PR** (`#n`, disabled with tooltip when the queue is empty), **Submit review** (existing `SubmitReviewPopover`).
- [ ] Height 44, `--bg-surface`, bottom `--border-subtle`. Commit.

### Task 7 (Lane A): PR queue, All PRs drawer, Next PR — mock 06

**Files:** `lib/review-queue.ts`, `lib/open-pr-review.ts`, `queue/AllPRsDrawer.tsx`, `components/PullRequestsTab.tsx` (refactor only), `tests/review-queue.test.ts`

- [ ] Extract `openPRWorkspace` from `PullRequestsTab.tsx` (uses `trpc.workspaces.getOrCreateReview`) into `open-pr-review.ts`; `PullRequestsTab` calls the extracted function. Behaviour identical.
- [ ] `review-queue.ts` (pure): from the same PR lists `PullRequestsTab` reads (`github.getMyPRs`, `atlassian.getReviewRequests`, `prPoller.getCachedPRs`) build `{ needsReview, waitingOnAuthor }`, excluding PRs the user authored (`role === "author"`); `nextPr(queue, currentKey)` / `prevPr` wrap-free.
- [ ] Drawer: 440px from the left with scrim, title, filter input, sections, rows (status: viewed progress / Mapping / New commits / Not mapped — derive from `useReviewPath` registry + `CachedPR.headCommitSha` vs last viewed), "Next" tag, footer auto-map checkbox + shortcut hints. Esc closes.
- [ ] Wire `next-pr`/`prev-pr` keys and the Next PR button to `open-pr-review.ts`.
- [ ] Tests for queue ordering/exclusion/next/prev. Commit.

### Task 8 (Lane B): Rail rows and path rail — mocks 02, 03, 05, 08, 09

**Files:** `rail/ReviewRail.tsx`, `rail/RailHeader.tsx`, `rail/PathRail.tsx`, `rail/RailRows.tsx`, `tests/review-workspace-rail.test.tsx`

- [ ] `RailHeader`: Path|Files segmented switch, agent line (`Claude Code · 2 entry points` / `is reading <file>` with spinner / `reviewed, N findings` / stale line "Path is from an older commit · Re-map"), progress bar + "x of y viewed", ⋯ menu (Re-map, Stop) or Stop button while mapping.
- [ ] Rows exactly per spec §8 "Row specs": `StepRow` (marker variants, filename, grey thread count, yellow finding count, `aria-current="step"`), `TestRow`, `ContextRow`, `SkeletonRow`; entry header with entry icon; decorative connector line; collapsed "Other files" / "Not placed yet".
- [ ] Rows render from `railItems()` only (no ordering logic in components).
- [ ] Resizable 240–360 reusing the navigator resize code; ⌘. collapses.
- [ ] Renderer test: given the fixture, renders 8 numbered steps, 5 tests, 1 context row, counts, current row has `aria-current` and **no** inset shadow class. Commit.

### Task 9 (Lane B): Map card and Files rail — mocks 01, 07

**Files:** `rail/MapPathCard.tsx`, `rail/FilesRail.tsx`; extend `tests/review-workspace-rail.test.tsx`

- [ ] `MapPathCard`: copy and controls per spec 5.1; Map this PR calls `start()`; agent picker lists configured CLI presets (read-only list from existing AI reviewer settings); checkboxes bound to the settings store.
- [ ] `FilesRail`: folder groups from `folderGroups()`, file rows with viewed marker, flask+count, thread count, finding count; current row raised.
- [ ] Rail mode resolution: store `railMode` ?? settings `defaultRailMode` ("auto" → path when `status` is ready/mapping/stale, else files).
- [ ] Tests: unmapped PR shows the card and alphabetical list; Files mode groups. Commit.

### Task 10 (Lane C): Step header, diff, focus lines, hint bar — mock 03

**Files:** `step/StepHeader.tsx`, `step/StepDiff.tsx`, `hooks/useFocusDecorations.ts`, `HintBar.tsx`; `views/ChangesView.tsx` (extract only)

- [ ] Extract the single-file diff logic from `ChangesView` (content queries, model swap, inline comment zones, thread decorations, gutter plus button, viewed mutation) into `StepDiff` with props `{ filePath, threads, readOnly, focus, onSelection }`. `ChangesView` uses `StepDiff` so the old shell keeps working.
- [ ] `StepHeader`: ‹ › (prev/next rail item), label from `stepLabel()`, path (folder `--text-tertiary`, filename `--text`), +/− from `details.files`, Viewed checkbox + `v` kbd; row 2 agent glyph + note + "more" (expands `detail`), right side "Tested by …" link(s).
- [ ] `useFocusDecorations(editor, focus)`: Monaco decorations — `lineNumberClassName` for bright semibold numbers on focus lines, a glyph decoration on the first focus line (agent icon, `--bg-overlay` square). Follow `useThreadDecorations.ts` for lifecycle/cleanup.
- [ ] `HintBar`: hints (j/k, v, select-to-ask, plus per-context extras like n/p, ⌘-click) and Unified/Split toggle (existing preference).
- [ ] Item switching: skeleton while loading, never old content under a new name. Commit.

### Task 11 (Lane C): Context files — mock 08

**Files:** `step/ContextFileView.tsx`

- [ ] Read-only Monaco editor (not diff) with content from `trpc.diff.getFileContent` at the PR head ref; header "Context", path, tag "Not changed in this PR", Remove from path (user or agent context; calls `removeContextStep`), agent note, focus decorations.
- [ ] "Used by" list from `ContextFileStep.usedBy`; rows link to steps or offer **Add to path** (`addContextStep`).
- [ ] ⌘-click on an identifier in `StepDiff`/`ContextFileView`: use the existing Monaco LSP bridge definition result (`renderer/lsp/monaco-lsp-bridge.ts`); if the target is a repo file not changed in the PR, open it as a transient context view with **Add to path** in the header. If no LSP result, do nothing (no error toast).
- [ ] Context items never call `markFileViewed`. Commit.

### Task 12 (Lane D): Inline findings and threads — mocks 05, 09

**Files:** `thread/FindingCard.tsx`, `thread/ResolvedThreadRow.tsx`, `thread/AgentNoteRow.tsx`; small edit in `useInlineCommentZones.tsx` to pick the variant

- [ ] `FindingCard` for `AIDraftThread` with `status === "pending"`: agent glyph, label, optional `category` tag (`--tag-amber-*`), "i of n", body, Accept / Edit / Dismiss (existing `onAccept` / `onSaveEdit` / `onDecline`), Ask about this (opens panel with anchor). Accepted/declined drafts keep the existing `ThreadCard` rendering.
- [ ] `ResolvedThreadRow`: one-line collapsed button for resolved threads; expands to `ThreadCard`.
- [ ] `AgentNoteRow`: renders `path.threadNotes[thread.id]` inside `ThreadCard` above the reply input.
- [ ] Outdated threads (`isOutdated`) are not placed on lines; `StepDiff` shows a quiet "1 comment on an earlier version · Show" row above the first hunk. Commit.

### Task 13 (Lane D): Side panel and Threads tab — mock 09

**Files:** `panel/SidePanel.tsx`, `panel/ThreadsTab.tsx`, `tests/review-workspace-panel.test.tsx`

- [ ] `SidePanel`: 400px overlay anchored right inside main, `--bg-surface`, left border, shadow `--shadow-lg`; tabs Threads (open count) | Ask agent; close button; Esc closes. Never resizes the diff.
- [ ] `ThreadsTab`: filters Open / Resolved / Mine (author = current user), grouped by step label from `numberSteps()` (other files under "Other files"), rows per spec 5.9, click → focus thread in diff (`openThreadInChanges` equivalent for the new shell) or file header for outdated; footer action opens Ask with a prefilled question.
- [ ] Panel test: grouping, filters, outdated row text. Commit.

### Task 14 (Lane D): Selection actions and Ask tab — mock 04

**Files:** `hooks/useSelectionActions.ts`, `panel/AskTab.tsx`, `panel/useAskAgent.ts`; extend `tests/review-workspace-panel.test.tsx`

- [ ] `useSelectionActions(editor)`: on a non-empty line selection in the modified side, show an inline view zone under the last selected line with **Ask agent** and **Comment** (`c`). Comment reuses the existing new-comment flow at the selection's last line; Ask sets `askAnchor` and opens the panel on Ask. Zone disappears when the selection clears.
- [ ] `useAskAgent(prCtx)`: `{ messages, send(text, anchor?), status }`. For now a fixture responder that returns `PR129_ASK_SAMPLE` for PR #129 and a polite "Agent not connected yet" message otherwise. Return type documented for the backend swap.
- [ ] `AskTab`: context chip (`file · start–end`), message bubbles, markdown answers, refs rendered as links (same file → reveal lines; other file → open its step or a context view), **Add as comment** (prefills composer on the anchor), Copy, composer with send (⌘↵).
- [ ] Tests: anchor chip text, Add as comment prefills, refs routing. Commit.

---

## Phase 2 — Integration

### Task 15: Wire the workspace and edge states

**Files:** `ReviewWorkspace.tsx`, `review-mode-store.ts`/`review-keymap.ts` integration, small glue edits

- [ ] Compose: top bar, rail, main (overview when unmapped or `overviewOpen`; else `StepDiff` or `ContextFileView` for the current rail item), hint bar, panel, drawer, existing `TerminalDrawer`.
- [ ] Keyboard via `useReviewKeymap` with `layout: "path"`; j/k follow `railItems()`; Esc follows `escapeTarget()`.
- [ ] Live mapping: new frames never change the current item or focus.
- [ ] States from spec §10: failed (Retry, Files fallback), stale (line under rail header; changed-away files move to Other files), closed/merged read-only, Bitbucket (viewed hidden), >100 files (virtualise rail rows), binary/missing files.
- [ ] Remove nothing from the old shell yet. Commit.

### Task 16: Verification and handoff

- [ ] Focused tests: `bun test tests/review-path-model.test.ts tests/review-path-fixtures.test.ts tests/review-path-source.test.ts tests/review-path-settings-store.test.ts tests/review-queue.test.ts tests/review-mode-store.test.ts tests/review-keymap.test.ts tests/review-workspace-rail.test.tsx tests/review-workspace-panel.test.tsx tests/review-mode-nav.test.ts tests/pr-review-threads.test.ts`.
- [ ] `bun run type-check` from repo root: no new diagnostics compared with a baseline run on the starting commit.
- [ ] `bun run check` clean.
- [ ] Visual check at a 1512×945 window with the preference on, PR #129 fixture: compare each state against mocks 01–09 side by side (layout, spacing, hierarchy; light theme should also look right through tokens). Note deviations in the handoff.
- [ ] Manual checklist: j/k instant; viewed only via `v`; context never counts; panel/drawer never reflow the diff; Esc order; ⌘↓ opens the next PR; flag off restores today's Review Mode exactly.
- [ ] Add a CLAUDE.md index entry routing to the spec and `ReviewWorkspace.tsx` (repo Maintenance rule). Commit.

## Acceptance criteria (whole feature)

1. With the preference on, PR #129 renders all nine mock states from fixtures at 1512×945 without clipping or horizontal scroll (except code).
2. Every changed file is reachable from the rail; coverage test passes.
3. Tests are always shown under the step they cover; unchanged tests open read-only.
4. No row uses a left-edge accent; only tokens are used.
5. Old Review Mode is unchanged with the preference off.
6. `useReviewPath` and `useAskAgent` are the only places that know data comes from fixtures.
