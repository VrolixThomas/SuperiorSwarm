# V4 Revision Pass 2 — Match Real App UI

Source of truth for review/solve/tickets UI is the real app code under
`apps/desktop/src/renderer/components/`. Screenshots the user shared
contain **private data** and must NOT seed mock content — only layout.

## Hard constraints

- **No private data from screenshots.** All branch names, file paths,
  comment text, ticket titles, commit subjects must be invented or reuse
  existing v4 mock data (`REPOS_V4`, `TICKETS_V4`, `feat/agent-terminal-chat`).
- **Mirror layouts, not pixels.** Match structural anatomy of the real
  components, but keep our color/scale conventions (`useColorsV4`).
- **Scene timings preserved** unless explicitly noted under each phase.

## Issue → scene → fix map

| # | Issue | Scene | Fix |
|---|-------|-------|-----|
| T48 | Diff/review pane is a tiny right panel using `DiffPanelHeader`, not the real Review tab | s5DiffPanel (2100–2640) | Mirror real `ReviewTab` in main content area |
| T49 | Center file-tree doesn't exist in real app | s6FileNav (2640–2880) | Drop — file list lives in persistent right panel only |
| T50 | s7 middle pane shows agent terminal stream during PR/comment context | s7PRComment (2880–3240) | Replace with real `SolveReviewTab` mirror |
| T51 | Workspace tab strip (`Terminal 1 / Review / …`) missing | All workspace scenes | Mount persistent top-level tab bar |
| T52 | Comments/review UI doesn't match real Solve Review tab | s7PRComment | Same as T50 (one fix) |
| T53 | Fabricated "Start worktree" pill on ticket card | s9Tickets (3720–4080) | Drop pill; show `TicketDetailPanel` split-screen on right |

---

## Phase 1 — Real Review Tab in s5DiffPanel

**Mirror source:** `apps/desktop/src/renderer/components/review/ReviewTab.tsx`
plus `ReviewFilterTabs.tsx`, `ReviewProgressBar.tsx`, `ReviewHintBar.tsx`,
`DiffEditor.tsx`.

**New file:** `apps/trailer/src/hero/build-v4/views/ReviewTabV4.tsx`

**Layout (top→bottom in main content area):**
1. `ReviewFilterTabsV4` — `All N` / `Working N` / `Branch N` tabs (Branch active)
2. Action row — `ReviewProgressBar` (e.g. `7 of 14 reviewed · 50%`) + Split/Unified pill
3. File path row — `apps/desktop/src/renderer/hooks/useAgentStream.ts`
4. Diff body — reuse existing trailer `CodeEditor` or render a simple
   two-column unified-diff mock (added/removed line gutters)
5. `ReviewHintBar` — keyboard hints (`j next · k prev · v viewed · ⌘e edit`)

**Right persistent panel** (re-uses the area currently holding
`DiffPanelHeader+SmartHeaderBar+DraftCommitCard+BranchChanges+CommittedStack`):
- BRANCH CHANGES — file tree grouped by top-level dir with `+/-` counts
- COMMITS — 4–5 fake commits (subjects like
  `feat(agent-terminal): stream stdout deltas`)

**New mock data** (in `data.ts`):
```ts
export const REVIEW_FILES_V4: { path: string; added: number; removed: number; viewed?: boolean }[];
export const REVIEW_COMMITS_V4: { sha: string; subject: string; relative: string }[];
```

**Animations:**
- Frame 0–30 of scene: filter tabs fade in
- 30–60: progress bar fills 0 → 50%
- 60–120: file list pops in (staggered, 8f each)
- 120–180: diff body fades in
- 240+: highlight cycles down file list (selected file changes every ~80f)

**Modify:** `WithRightPanelChanges.tsx` becomes a thin wrapper that mounts
`RepoSidebarV4 + ReviewTabV4 + RightPersistentPanelV4`.

## Phase 2 — Drop center file-tree (s6FileNav)

File navigation already happens in the BRANCH CHANGES tree on the right
panel from Phase 1. The center file-tree scene is redundant.

**Option A (recommended):** Repurpose s6FileNav as a 4-second keyboard-nav
demo inside the Review tab — highlight cycles `j` through three files,
diff body updates, no layout change. Cheap, reuses Phase 1 components.

**Option B:** Delete s6FileNav, reduce `TOTAL_FRAMES_V4` by 240
(4680 → 4440), shift downstream scenes earlier.

## Phase 3 — Solve Review Tab in s7PRComment

**Mirror source:** `apps/desktop/src/renderer/components/SolveReviewTab.tsx`
plus `solve/SolveSidebar.tsx`, `solve/SolveDiffPane.tsx`,
`solve/SolveCommentCard.tsx`.

**New file:** `apps/trailer/src/hero/build-v4/views/SolveReviewV4.tsx`

**Layout:**
1. Header row — branch chip + `8 resolved · 2 unclear` pills + APPROVAL progress bar (fills during scene)
2. Left column (~460px):
   - File group cards (3–4 cards, collapsible look, "Pushed" pill on resolved)
   - First expanded card shows FILES list + COMMENTS thread:
     - 2 fake comments with author chip, body, `Follow up` + `Fixed` badges
     - One unresolved comment with reply input affordance
3. Right column (flex): Monaco-style diff (reuse trailer CodeEditor or
   render a simple unified-diff block)
4. Bottom strip: `J ↓ · K ↑ · G Group · A Approve · P Push` action bar

**Right persistent panel** (replaces current `CommentsOverviewTab` mount):
- Branch name
- `8 resolved · 2 unclear · 4 pushed · 0 of 6 groups approved`
- Group checklist (✓ resolved / ◯ unclear)
- `Open Solve Review` big button
- SOLVE HISTORY: `Session #1 · 2d ago`

**New mock data** (in `data.ts`):
```ts
export const SOLVE_GROUPS_V4: {
  title: string;
  status: "pushed" | "open";
  files: string[];
  comments: { author: string; body: string; status?: "fixed" | "follow-up" }[];
}[];
```

Mock comments must be generic, e.g.:
- `"can we extract this into a helper? it's reused in two places"`
- `"nit: add a test for the null branch"`
- `"lgtm once the rebase lands"`

**Timing concern:** s7PRComment is 6s (360f). SolveReviewTab is dense.
Suggest extending to 540f (9s) by stealing 180f from s8SolveResult (480→300)
OR adding 180f to total. See questions below.

## Phase 4 — Tickets split-screen (s9Tickets)

**Mirror source:** `apps/desktop/src/renderer/components/tickets/TicketDetailPanel.tsx`

**Modify:** `WithTicketsTab.tsx`
- Remove `Start worktree` pill on SS-148 card
- Keep `TicketsSidebarInline` on left
- Compact `TicketsBoardInline` to ~60% width
- Mount new `TicketDetailPanelV4` on right showing SS-148 detail:
  - Status pill (In Progress)
  - Title (`SS-148 — Resume agent on focus`) — use existing TICKETS_V4 title
  - Assignee avatar row
  - Description (3–4 lines of invented prose)
  - `Create branch` action button (subtle, real-app style)

**Frame trigger:** detail panel slides in at frame 120 (when SS-148 becomes
focal) instead of the current pill animation.

## Phase 5 — Workspace tab strip

**Mirror source:** find in `apps/desktop/src/renderer/components/` —
likely `WorkspaceTabs.tsx` or part of `WorkspaceShell.tsx`.

**New component:** `apps/trailer/src/hero/build-v4/WorkspaceTabBar.tsx`

**Tabs (per scene):**
| Scene | Visible tabs | Active |
|-------|--------------|--------|
| s1Terminal | `Terminal 1` | Terminal 1 |
| s2SidebarBuild–s4AgentsDone | `Terminal 1` | Terminal 1 |
| s5DiffPanel, s6FileNav | `Terminal 1 · Review` | Review |
| s7PRComment | `Terminal 1 · Review · Solve Review` | Solve Review |
| s8SolveResult | `Terminal 1 · Review · Solve Review` | Solve Review |
| s9Tickets, s10PRsList | (no workspace tabs — these are sidebar nav switches) | — |

**Mount:** above main pane in `WorkspaceShellV4.tsx`, height ~32px, drag region.

## Phase 6 — Audit existing Repos/Tickets/PRs strip

Currently `WithTicketsTab` and `WithPRsTab` render an inline
`Repos · Tickets · PRs` horizontal strip at top of sidebar. Verify against
`apps/desktop/src/renderer/components/Sidebar.tsx`:
- If real app uses leftmost icon rail (vertical), replace with that.
- If real app uses horizontal strip, keep current layout.

## Decisions

1. **Phase 2:** Option A — repurpose s6FileNav as keyboard-nav demo inside Review tab.
2. **Phase 3:** Steal 180f from s8SolveResult. `s7PRComment: 360→540`, `s8SolveResult: 480→300`. Total stays 4680.
3. **Phase 5:** Workspace tab strip appears from s5 onward only.
4. **Mock data:** Reuse `SuperiorSwarm` repo + `feat/agent-terminal-chat` branch + invented comments. Zero data from screenshots.
