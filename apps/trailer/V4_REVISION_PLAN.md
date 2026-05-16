# Trailer v4 — Revision Plan

Eleven tracked tasks (#37–#47) from the frame-by-frame review. Plan groups them by scene in timeline order so we can execute sequentially without re-rendering between unrelated changes.

All paths are relative to `apps/trailer/`. Real-app components live in `../desktop/src/renderer/components/`. Scaled mirrors live in `src/hero/build-real/`.

---

## Decisions (resolved with user)

**Q1 — Repos in sidebar (#39).** Use the v2/v3 repo list (from `build-v2/Workspace.tsx`):

```
SuperiorSwarm   (entryDelay 0)
mcp-lab         (entryDelay 60)
agent-skills    (entryDelay 80)
prompt-registry (entryDelay 100)
```

SuperiorSwarm stays the one we expand; the other three appear collapsed in the list. Worktrees under SuperiorSwarm: keep the current 8 (no change to `WORKTREES_SS`-equivalent in v4).

**Q2 — Cut `s11ReviewResult`.** The "bad one with only half the tab shown" = `s11ReviewResult` (PRReviewResult view). Keep `s10PRsList` ("Review what others ship.") since the user said the previous tab was better. Action in Phase 9: delete `views/PRReviewResult.tsx`, drop the case from `WorkspaceViewSelector`, remove `s11ReviewResult` from `timeline.ts`, drop the `s11` beat from `beat-copy.ts`, audit `AudioTracksV4` / `audioManifest.gen.ts`.

**Q3 — Outro logo = website AnimatedLogo.** Source: `apps/website/src/components/animated-logo.tsx`. It's a self-contained particle-cluster SVG (1024×1024 viewBox, orange/red palette, breathing scale per particle group). Port to Remotion (the file uses SVG `<animate>` / `<animateTransform>` — those play in real wall-clock time and won't sync deterministically with Remotion's frame-based render; replace each `<animate>` with frame-driven `interpolate(useCurrentFrame(), ...)` so the breath is deterministic). Color family already matches the active agent indicator (`SwarmIndicator` uses the same orange/yellow/green family). CTA copy: `superiorswarm.com` (primary, large) + `Download for macOS` (sub-line). No "Get early access". No tagline.

---

## Architectural flag (read before reviewing #40)

**#40 is not a one-file change.** Each view (`WithSidebarRepos`, `WithActiveWorkspaces`, …) currently re-mounts on scene boundary via `WorkspaceViewSelector.selectView(frame)`. Re-mounting kills any "state" the previous scene built. Two ways to fix:

- **(a) Persistent shell** — `WorkspaceShellV4` always renders the sidebar (one component, frame-aware), and only the right pane (terminal / diff / tickets board / PRs / solve / review) is swapped by `selectView`. Cleanest, but it's a refactor of how scenes compose.
- **(b) Sidebar-as-prop** — every view imports the same `<SidebarV4 frame={...} />` so the structural chrome is identical and only state-driven internals (SwarmIndicator colors, active row, expanded repo) change with frame.

Recommend **(a)** — single source of truth, no risk of two sidebars drifting. This refactor is a prerequisite for #40, #41, and arguably #39 — so do it once, early, then the per-scene changes get small.

---

## Execution plan (timeline order)

### Phase 0 — Refactor: persistent sidebar shell (enables #39, #40, #41)

**Files:**
- `src/hero/build-v4/WorkspaceShellV4.tsx` — render `<SidebarV4 />` + `<MainPaneV4 viewKey={...} />` side-by-side. Sidebar lives outside the view switcher.
- **New:** `src/hero/build-v4/SidebarV4.tsx` — single sidebar component. Reads `useCurrentFrame()`, derives:
  - active segment (Repos / Tickets / PRs) per scene
  - which repo is expanded
  - per-worktree SwarmIndicator alert state (off / active / needs-input / task-complete) per scene
  - "Add Repository" button + Settings footer (matches real `Sidebar.tsx`, see Phase 1)
- `src/hero/build-v4/WorkspaceViewSelector.ts` — split into `selectSidebarState(frame)` and `selectMainPane(frame)`. Main pane returns only what changes (terminal grid / single terminal / diff / tickets / PRs / solve / review).
- All `views/With*Repos.tsx` and `views/With*Workspaces.tsx`: delete their sidebar markup; they become main-pane-only.

**Verify:** existing scenes still render visually identical at frames {200, 800, 1500, 1900, 2300, 2700, 3000, 3400, 3900, 4200, 4500, 4900}. Snapshot each before refactor, diff after.

---

### Phase 1 — Opening (#37, #38)

**#37 — Vary opening terminals.** Files: `src/hero/build-v4/data.ts` (`OPENING_TERMINALS_V4` + `swarmLines`).

- Replace the single `swarmLines(label)` factory with **per-tile scripts**. Each tile gets a distinct narrative:
  - tile 0 (`auth-refactor`): fast — boots, runs tests, ✓ in 3s.
  - tile 1 (`migration-runner`): slow stream — multiple "running migration N of 12" lines, ends with success.
  - tile 2 (`pty-dedup`): mixed — finds bug, prints stack-trace-style red lines, then ✓.
  - tile 3 (`review-pr-214`): pauses in the middle ("waiting for token…"), then bursts.
  - tile 4 (`rebuild-graph`): heavy IO — long file paths scrolling, single final ✓.
  - tiles 5–7 (claude / codex / gemini): already distinct; tighten copy so no two have the same line cadence.
- Vary line counts (6–14), color mixes (more red on the bug tile, more blue on the gemini tile), and `from:` timing so the tiles feel like they're running independently — not in lockstep.
- Add 1–2 tiles with a brief idle moment so the eye gets a rest before the merge.

**#38 — Replace 8→1 enlarge with merge.** Files: `src/hero/build-v4/scenes/Opening8Terminals.tsx`.

Current behavior: tile index 4 scales 2.3× while others fade. Replace with a **converge-and-merge**:

- During `COLLAPSE_START → COLLAPSE_END` (frames 360→420):
  - Each tile interpolates its grid `(left, top, width, height)` toward the single-terminal target rect (whatever `TerminalOnly` renders at frame 420 — read its bounds).
  - Tiles stay opaque through ~75% of the merge, then crossfade so eight overlapping rects become one (no visible "winning" tile).
  - Bonus: at ~95%, blur the merged stack briefly (filter: blur(4px) → 0) for a soft "settle" feel — keeps the cut to `TerminalOnly` from being a jump.
- Remove the `isAnchor` / `collapseScale` 2.3× logic.
- The terminal labels in the header bar fade together; the resulting single terminal can show a synthesized "watching 8 agents" prompt (matches the next caption "You watch from one place.").

**Verify:** scrub frames 350→425 in Chrome studio; no scale pop, no winner-tile, smooth handoff into `s1Terminal`.

---

### Phase 2 — Sidebar build (#39)

**Files:**
- `src/hero/build-v4/data.ts` — REPOS_V4 expanded per **Q1** answer.
- `src/hero/build-v4/SidebarV4.tsx` (from Phase 0).
- `src/hero/build-v4/views/WithSidebarRepos.tsx` — becomes a thin wrapper that just gates the sidebar's build-up animation via frame.

**Real `Sidebar.tsx` reference** (verified by reading the source):

```
[52px traffic light clearance]
[Segmented control: Repos | Tickets | PRs]  ← top, border-bottom
[Segment content: scroll area]
  ├─ ProjectList (repos, each expandable; worktrees nested with WorkspaceItem)
  └─ "+ Add Repository" button  ← INSIDE scroll area, immediately below ProjectList
[Footer: Settings]  ← border-top, fixed bottom
```

The current `WithSidebarRepos` puts "Add Repository" in its own div between the worktree list and the Settings footer with a separate fade — this is the wrong place. Fix: move the button into the same scroll area as the repo list, directly under the last repo (matches Sidebar.tsx:91–114).

**Sequence rebuild for s2SidebarBuild (frames 660–1200, 540f):**

| local frame | event |
| --- | --- |
| 0–30 | Sidebar pane slides in from left (existing). |
| 30–90 | Repos / Tickets / PRs tab strip appears. |
| 90–240 | N repo rows fan in (one per ~30f, depending on Q1 count) — all collapsed (▸). |
| 240–300 | One repo (SuperiorSwarm) gets a "click" highlight, expands (▸ → ▾). |
| 300–450 | Worktrees fan in below SuperiorSwarm (one per ~20f). |
| 450–540 | "Add Repository" button fades in inside scroll area; Settings footer fades in. |

Drop the auto-expand at entry; worktrees only appear after the explicit expand stage.

**Verify:** scrub 660→1200 — repo cards land first, click-expand reads as a discrete moment, Add Repository sits flush under the last repo (not floating above Settings).

---

### Phase 3 — Active workspaces / done (#40, #41)

**#40 — Preserve sidebar.** Handled by Phase 0 refactor. Per-scene work:

- `selectSidebarState(s3StartWS)` → keep all expanded repos from s2; per-worktree alert = `active` for the ones starting work, others `null`.
- `selectSidebarState(s4AgentsDone)` → same structure; flip alerts to `task-complete` as agents finish (staggered).

No structural re-animation between s2 → s3 → s4. Only `SwarmIndicator` color/state changes.

**#41 — Remove fabricated "done" mark.** Audit first — I have NOT yet located the offending markup.

- Grep for done/complete badges in: `views/WithActiveWorkspaces.tsx`, `WithSidebarRepos.tsx`, anything in `scenes/` referencing s4.
- Real app shows ONLY the green `SwarmIndicator` (task-complete state) — no badge, no checkmark, no "done" label.
- Strip whatever extra mark we added; keep only the indicator color transition (orange → green via the alert state).

**Verify:** s4 frame 1900 — only the green dot indicator next to completed worktrees; no text/badge.

---

### Phase 4 — Diff panel (#42)

**Files:**
- `src/hero/build-v4/views/WithRightPanelChanges.tsx` (s5DiffPanel) — rewrite right pane.
- Use real scale-mirrors from `src/hero/build-real/`: `SmartHeaderBar.tsx`, `BranchChanges.tsx`, `CommittedStack.tsx`, `DraftCommitCard.tsx`.

**Real `DiffPanel.tsx` reference:**

```
[PanelHeader: tab strip [Changes | Files | Comments | Fixes] + close X]
[SmartHeaderBar: base branch chip + actions]   ← when Changes tab active
[Scrollable timeline:]
  ├─ DraftCommitCard (working changes / stage / unstage)
  ├─ BranchChanges (full diff vs base)
  └─ CommittedStack (commits ahead)
```

Currently s5 shows BranchChanges only and no visible diff in the center. Fix:

- Right panel: full DiffPanel mirror — PanelHeader (Changes tab active) → SmartHeaderBar → DraftCommitCard → BranchChanges → CommittedStack. Use existing build-real components (they already mirror real markup).
- Center pane: render an actual diff for the active file (use one of the `DEMO_FILES_V4` hunks). Currently the diff isn't visible — likely the `DiffHighlight` overlay is offscreen or behind the panel. Verify with a frame screenshot before fixing.

**Verify:** s5 frame 2300 — right panel has tab strip + header + all three timeline sections visible; center shows a real diff with green/red lines.

---

### Phase 5 — File nav (#42 same scene class)

`src/hero/build-v4/views/WithFileNav.tsx` (s6FileNav). Same right-panel chrome as Phase 4 but with the Files tab active in PanelHeader (instead of Changes), and the center shows the file tree → file diff transition. Reuse `build-real/RepoFileTree.tsx`.

---

### Phase 6 — PR comments + remove cursor (#43)

**Files:**
- `src/hero/build-v4/views/WithCommentsPR.tsx` (s7PRComment).
- `src/hero/build-v4/scenes/AIResolveCursor.tsx` — remove.
- `src/hero/build-v4/WorkspaceShellV4.tsx` (or wherever AIResolveCursor is mounted) — drop the import + render.

**Tasks:**
- Match real DiffPanel chrome (Comments tab active in PanelHeader). Currently the right panel uses `CommentsOverviewTab` directly without the surrounding tab strip / header — add it.
- Delete `AIResolveCursor` entirely (file + mount sites). The "click the Solve-with-AI button" beat reads fine without a cursor — the panel can just transition to the solve state.

**Verify:** s7 frame 3000 — full panel chrome above CommentsOverviewTab; no floating cursor anywhere.

---

### Phase 7 — Solve result (#44)

**Files:** `src/hero/build-v4/views/SolveResultFull.tsx` (s8SolveResult).

**Audit step (do BEFORE writing the fix):**
1. Navigate Chrome studio to `?frame=3400` (mid-s8), screenshot.
2. Inspect: are the 280px left panel and 420px right panel visually present but empty? Transparent? Off-frame? The component markup includes both — so the question is why they disappear visually.
3. Likely root causes:
   - **Background bleed:** `SolveSidebar` / `SolveReviewTab` have no explicit bg; they inherit transparent → blends with `bgBase` center → looks like one panel.
   - **Height collapse:** the build-real components assume `h-full` parents; the v4 wrapper gives them height via flex but the inner content uses absolute units → collapses.
   - **Overflow clip:** content too tall for the column width, `overflow:hidden` clips it to nothing visible.

Once root cause identified, fix targeted:
- Force explicit `background: c.bgSurface` on left + right wrappers + visible borders.
- Ensure left and right inner components have `height: 100%` and `display: flex; flex-direction: column`.
- If content is genuinely too dense: reduce `MOCK_SESSION` groups to 1 group / 2 files for this scene (a different mock for trailer-scale legibility — keep MOCK_PR intact for other scenes).

**Layout target:** match real app's solve view exactly — `[SolveSidebar | SolveDiffPane | SolveReviewTab]` with all three panels visibly distinct (background contrast + borders) and the diff readable at video scale.

**Verify:** s8 frames 3260, 3400, 3600 — three columns each clearly separated, diff readable, review tab content readable, no panel disappears.

---

### Phase 8 — Tickets (#45)

**Files:** `src/hero/build-v4/views/WithTicketsTab.tsx` (s9Tickets).

**Real-flow constraints:**
- Tickets tab uses `TicketsSidebar` (real: `apps/desktop/src/renderer/components/tickets/TicketsSidebar.tsx`). Need to mirror it in `build-real/` — currently we don't have a TicketsSidebar mirror. Add one (small): list of tickets with state pill, ticket ID, title.
- The center pane is the kanban `TicketsBoardView`. Already partially mirrored inline in WithTicketsTab; reuse the inline `TicketsBoardInline` (it already matches real column-header style per the cleanup pass).
- **You cannot open a terminal inline while on Tickets tab.** Opening a worktree switches the sidebar away from Tickets to Repos (and the main pane to the workspace view). For this scene we are NOT doing that transition.

**Scope reduction:**
- Strip the `WORKTREE_BOOT` terminal and the `CLICK_FRAME → terminal` swap from `WithTicketsTab.tsx`. This scene shows ONLY:
  - Tickets sidebar on left.
  - Kanban board on right.
  - At ~frame 90 local: a small "Start worktree" affordance highlights on a ticket card (hover-like outline + cursor-free pulse) and a tooltip-style chip "→ creates worktree". No actual transition.
- The terminal scene already exists earlier in the timeline (s1Terminal, s3StartWS); we don't need to re-show it here.

**Verify:** s9 entire range — sidebar stays Tickets, no terminal pane appears, "Start worktree" affordance is clearly visible but doesn't trigger a scene change.

---

### Phase 9 — Cut redundant PR scene (#46)

Depends on **Q2**. Two cases:

**If A (cut s10PRsList):**
- Delete `views/WithPRsTab.tsx` + remove from `WorkspaceViewSelector`.
- Remove `s10PRsList` from `timeline.ts`; collapse durations so `s11ReviewResult` starts where `s9Tickets` ends.
- Update `beat-copy.ts` — drop the s10 caption.
- Update `AudioTracksV4` / `audioManifest.gen.ts` if any cue is keyed to s10.

**If B (cut s11ReviewResult):**
- Delete `views/PRReviewResult.tsx`.
- Same timeline + beat-copy + audio updates.

**If C (rebuild):** I'll need to know which one and what the new beat should communicate.

Either way: re-run `bun test` (`data-v4.test.ts` may need updates), re-render to verify total length math.

---

### Phase 10 — Outro (#47)

Depends on **Q3**. General shape:

**Files:**
- `src/hero/build-v4/timeline.ts` — replace `endHold: { from: 4860, duration: 120 }` (2s) with `outro: { from: ..., duration: 240–360 }` (4–6s).
- **New:** `src/hero/build-v4/scenes/Outro.tsx` — full-screen, separate from `WorkspaceShellV4`.
- `WorkspaceShellV4.tsx` — gate render so it returns null during the outro range; mount `<Outro />` instead.
- `beat-copy.ts` — replace the "SuperiorSwarm." caption with the CTA copy.

**Outro contents:**
- Large centered logo (~30% of frame height) with breathing animation: scale 1 → 1.04 → 1 over ~2s, opacity 1 → 0.85 → 1 in sync. Use spring or sine-wave interpolation, not linear.
- CTA below logo (~24px in design / large at video scale): the URL or copy from Q3.
- Background: matches `bgBase` or a very subtle radial gradient toward the logo (no aggressive color shift — feels cheap at video scale).
- Hold 3–4s total, ending on a frame the user can pause on without weirdness.

**Audio:** if there's a music bed, taper to silence over the last 1s — fixed by `AudioTracksV4` envelope, not a new file.

---

## Test + verification cadence

After each Phase, run:

```bash
cd apps/trailer
bun test            # 39 tests today; some will need updating in Phase 9
bun run type-check
bunx biome check --fix
```

Visual check in Remotion studio at the specific frames listed under each Phase. Do NOT do a full render between phases (8–15 min each); just scrub.

Single full render at the end:

```bash
cd apps/trailer && bun run render -- v4
```

---

## Order summary

```
0. Refactor: persistent sidebar shell                  (foundational)
1. Opening (#37 #38)                                   (frames 0–420)
2. Sidebar build (#39)                                 (frames 660–1200)
3. Active workspaces + done (#40 #41)                  (frames 1380–2100)
4. Diff panel right pane (#42)                         (frames 2100–2640)
5. File nav (#42 same chrome)                          (frames 2640–2880)
6. PR comments + remove cursor (#43)                   (frames 2880–3240)
7. Solve result (#44, AUDIT FIRST)                     (frames 3240–3720)
8. Tickets flow scope reduction (#45)                  (frames 3720–4080)
9. Cut redundant PR scene (#46, NEEDS Q2)              (frames 4080–4860)
10. Outro (#47, NEEDS Q3)                              (replaces endHold)
```

Commit boundary suggestion: one commit per Phase. Keeps `git bisect` useful if a later phase regresses an earlier one.

---

## Execution log

All 11 tasks completed in a single revision pass. Tests pass (38/38), type-check clean, Biome clean (3 pre-existing warnings in build-v3/PullRequestItem, unrelated).

| Task | Status | Files |
|---|---|---|
| #37 vary opening | done | `data.ts` per-tile scripts |
| #38 merge transition | done | `scenes/Opening8Terminals.tsx` (8 tiles converge to one rect, settle blur) |
| #39 sidebar build / Add Repo placement / more repos | done | `data.ts` (4 repos from v2), new `RepoSidebarV4.tsx` (Add Repository inside scroll area per real Sidebar.tsx) |
| #40 preserve sidebar state | done | shared `RepoSidebarV4` used by s2→s7; build-up plays only inside `s2SidebarBuild`, then `past=true` holds final state forever |
| #41 fake "done" mark | done | removed `✓ done` div from `WithActiveWorkspaces.tsx`; green SwarmIndicator only |
| #42 right panel chrome | done | new `build-real/DiffPanelHeader.tsx` + SmartHeaderBar + DraftCommitCard + BranchChanges + CommittedStack composed in `WithRightPanelChanges.tsx` and `WithFileNav.tsx` |
| #43 panel header + remove cursor | done | `DiffPanelHeader` (Comments tab) in `WithCommentsPR.tsx`; deleted `scenes/AIResolveCursor.tsx` + drop mount in `HeroBuildV4.tsx` |
| #44 SolveResultFull panels | done | wrappers now `display:flex flex-direction:column` so child `h-full` resolves; explicit bg + borders on all 3 columns |
| #45 Tickets flow | done | `WithTicketsTab.tsx` rewritten — TicketsSidebar mirror (All Tickets + Linear projects) + kanban board; "Start worktree" affordance only, no terminal swap |
| #46 cut s11ReviewResult | done | deleted view, ViewSelector case, timeline scene, s11 caption, s11 chime trigger |
| #47 outro | done | new `scenes/AnimatedLogoV4.tsx` (frame-driven port of website AnimatedLogo) + `scenes/Outro.tsx` (logo + "superiorswarm.com" + "Download for macOS"); `WorkspaceShellV4` returns null during outro range |

Bonus: added Repos/Tickets/PRs strip above `PullRequestsTab` in `WithPRsTab.tsx` so the sidebar chrome matches real `Sidebar.tsx` (PRs tab active).

New total: **4680f / 78s** (was 4980f / 83s).
