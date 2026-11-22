# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Tech Stack

Electron + React 19 + TypeScript. Bun (runtime + package manager). Turbo (monorepo). tRPC over Electron IPC (not HTTP). SQLite + Drizzle ORM. Biome (lint/format). xterm.js + node-pty (terminal).

## Commands

All commands use **Bun** as the package manager and runtime.

```bash
# Root-level (runs via Turbo across workspaces)
bun run dev          # Start Electron dev server
bun run build        # Production build
bun run lint         # Biome linting
bun run format       # biome format --write .
bun run check        # biome check --write . (format + lint + organize imports)
bun run type-check   # TypeScript noEmit check

# Desktop app (from apps/desktop/)
bun test             # Run tests with Bun's test runner
bun run db:generate  # Generate Drizzle ORM migrations
```

To run a single test file: `bun test tests/cmd-buffer.test.ts`

Full-suite `bun test` (159 files) is unreliable locally: ~100+ failures are 5s-timeout/fd-exhaustion flakiness under load, not real breakage. Verify changes per directory (e.g. `bun test tests/daemon/`) and compare full-run failure sets against a baseline run before blaming a diff.

## Architecture

- **Processes:** main (`src/main/`) / daemon (`src/daemon/`) / renderer (`src/renderer/`) + preload script (`src/preload/`)
- **Cross-process types** → `src/shared/` (define new types here, not inline in process code)
- **tRPC router** → `src/main/trpc/` (over Electron IPC via `ipcLink`, not HTTP)
- **Terminal PTY daemon** → `src/daemon/` (Unix socket; spawned with `SUPERIORSWARM_SOCKET_PATH`, `SUPERIORSWARM_DB_PATH`, `SUPERIORSWARM_DEV_MODE`)
- **Staircase text after TUI exit** → `src/daemon/shell-integration.ts`; zsh must restore `opost onlcr` from a prompt hook because external PTY repairs are overwritten by its saved settings. `src/main/terminal/ipc.ts` supplies the startup environment for new shells on older daemons too. Existing shells need `stty opost onlcr`; `SUPERIORSWARM_SHELL_INTEGRATION=0` opts out before launch. Regression: `tests/terminal-output-recovery.test.ts`.
- **Terminal replay/history** → `src/daemon/terminal-replay-buffer.ts`, `src/shared/terminal-replay.ts`, `src/renderer/components/terminal-replay.ts`; snapshot-capable clients restore rendered history at its original dimensions, with legacy daemon compatibility. See `.hermes/plans/codex-chat-scroll-investigation.md`.
- **Terminal file insertion** → `src/main/terminal/daemon-client.ts`, `src/renderer/components/terminal-file-controller.ts`; live daemons without file-input capabilities use locally inspected, insertion-only pastes. Failed attachments must not capture ordinary Enter; verify legacy delivery with `tests/terminal-file-legacy.test.ts`.
- **Workspace/coordinator terminal roots and restore** → `src/main/agent-launch/workspace-cwd-lookup.ts`, `src/main/terminal/ipc.ts`, `src/main/trpc/routers/terminal-sessions.ts`; IPC error contract → `src/shared/terminal-create.ts`; isolated lifecycle coverage → `tests/terminal-workspace.test.ts`.
- **Native terminal file drops** → `src/renderer/components/terminal-file-drop.ts`; request `copy` because Chromium rejects `link` for copy-only native drags. `tests/terminal-file-electron.test.ts` exercises native drag events through production tRPC on current and legacy daemons.
- **Packaged file insertion / native helper lookup** → `apps/desktop/electron.vite.config.ts` keeps main-process chunks beside native helpers. `tests/terminal-file-electron.test.ts` must use multi-entry Vite output (a forced Bun `__dirname` hides broken release paths); covers legacy daemons and surviving capability-aware daemons with broken inspectors. `src/daemon/terminal-process-identity.ts` bounds cold helper startup below the file-request deadline.
- **Built daemon startup / external CommonJS imports** → `tests/daemon-built-startup.test.ts`; exercises Electron's native ESM loader, unlike Bun-bundled source tests.
- **Terminal scroll speed baseline** → `src/renderer/components/terminal-wheel.ts`, `tests/terminal-wheel-native.test.ts`; default sensitivity is 1, application wheel input stays with xterm, and only normal scrollback LINE/PAGE units are normalized.
- **Returning to chats on older daemons** → `src/main/terminal/view-sessions.ts`; retain parsed state and the daemon subscription while a renderer is detached. Explicit tab/pane closure → `src/renderer/lib/pane-lifecycle.ts` and `src/main/terminal/ipc.ts`.
- **Scroll regression reassessment / release gates** → October 13 plan in `.hermes/plans/codex-chat-scroll-investigation.md`; covers legacy reconnect cache duplication, parser batching, cancelled input accounting, and physical-device baseline validation.
- **Terminal lifecycle / recovery diagnostics** → `tests/terminal-lifecycle-electron.test.ts` (real React, preload, IPC, socket, PTY; `SS_SOAK_MS` for soak); `terminal:diagnostics` and `src/renderer/components/terminal-diagnostics.ts` expose content-free state on demand.
- **Build-time env injection** → `electron.vite.config.ts` `define` block (OAuth + Supabase credentials are NOT in runtime `process.env`)
- **Updater validation / window lifecycle** → `src/main/updater-lifecycle.ts`, `src/renderer/hooks/use-updater.ts`, `tests/updater-validation.md`; MacUpdater’s downloaded event precedes native validation, and its early quit callback persists across errors.
- **Desktop releases** → `.github/workflows/release-desktop.yml`; the manual `tag` input rebuilds that exact Git tag with pinned signing tooling.
- **MCP server** → `mcp-standalone/` (native modules rebuilt against Electron ABI; launched via `ELECTRON_RUN_AS_NODE=1`)
- **Shared worktree file links** → `src/main/shared-files.ts`; metadata-only browser link rows → `src/main/git/file-tree.ts`; explicit link reads/saves → `src/main/git/workspace-file-ops.ts`.
- **Files browser vs legacy enumeration** → `src/shared/file-browser-types.ts`, `src/shared/file-browser-policy.ts`; registered file roots → `src/main/git/workspace-file-root.ts`; focused type-check → `tests/tsconfig.file-browser.json`.
- **Diff Markdown previews** → `DiffFileTab.tsx`, `PRReviewFileTab.tsx`, `review/ReviewTab.tsx`, `review-mode/views/ChangesView.tsx`; the global `markdownPreviewMode` must be scoped to each file's language before hiding Monaco or rendering previews.
- **Reading-path remediation / manual draft authority** → `main/ai-review/manual-comment.ts`, `renderer/lib/review-draft-binding.ts`; scoped manual comments follow the workspace draft and current mapping generation, never timestamp ties. Owned terminal recovery → `main/terminal/review-terminal-ownership.ts`, `ipc.ts`, and `daemon-client.ts` (attach only, including not-found races). Publishing capability → `providers/types.ts` and `review-publisher.ts`; Bitbucket pinned inline publication is explicitly unsupported. Acceptance evidence → `docs/superpowers/plans/2026-11-21-pr-reading-remediation-verification.md`.
- **Agent reading-path review workspace** → `src/renderer/components/review-mode/ReviewWorkspace.tsx`, `ReviewReadingPane.tsx`, and `lib/review-path-model.ts`; replaces Review Mode by default with a full-window shell. Shared data remains in `useReviewWorkspaceData.ts`; fixture-only mapping/Ask boundaries require explicit opt-in. Spec and limitations → `docs/superpowers/specs/2026-11-21-agent-reading-path-design.md` and `docs/superpowers/plans/2026-11-21-agent-reading-path-handoff.md`.
- **PR agent workspace / ended sessions** → `renderer/lib/review-terminal-tab.ts` opens normal tabs inside `ReviewAgentWorkspace.tsx`, preserving the full-window PR header. `ReviewAgentTerminal.tsx` checks read-only `reviewPath.terminalState` before mounting a PTY; completed runs without session rows remain inspectable without recreating agents. The default reading workspace never renders the legacy terminal drawer.
- **PR review edge-case recovery** → FindingCard editors key drafts by `draftCommentId`; agent “Review findings” sends a revision-scoped request consumed by ReviewWorkspace's inline-finding navigator (not provider Threads), including loading/empty/missing-draft outcomes. Explicit Refresh awaits snapshot recreation before invalidating workspace file/context content queries. Auto-map expands captured abbreviated Bitbucket heads in the verified source repository before full-OID validation. Regressions: `review-finding-editor-drafts`, `review-agent-findings-navigation`, `review-snapshot-refresh`, `review-path-auto-map`, `bitbucket-revision-resolution`.
- **Reading-path label wrapping** → `review-mode/rail/RailRows.tsx` wraps full filenames at word/CamelCase boundaries; `RailList.tsx` measures natural row heights for virtualization and only scrolls on a new selection. Width changes invalidate measurements; measuring rows during manual scrolling must not jump back to the selected file. Native tabs fixture verifies long labels and selection at 236/288/360px.
- **PR workspace tabs** → `review-mode/PRReviewWorkspace.tsx` owns shared PR chrome above the existing pane layout. Pinned `pr-review` and durable `review-agent` tabs use normal workspace split/focus/persistence. `ReviewAgentTab.tsx` renders preparing/running/failed/ended jobs; closing hides a job, explicit Stop cancels. Never mount an unverified owned PTY or an ordinary shell in a logical PR root.
- **Recording-based PR navigation redesign (plan)** → `docs/superpowers/plans/2026-11-22-pr-review-workspace-navigation-plan.md`; video-timestamped audit, persistent Review/agent-job tabs, cancellable preparation, performance acceptance tests, and a target-tip versus merge-base scope check. Interactive concept and evidence crops live under `docs/superpowers/specs/assets/2026-11-22-pr-review-navigation/`. Its backend job contract is implemented by `review-path/application.ts` + `storage.ts`; visual precedence belongs to the workspace-tabs plan.
- **13-board PR workspace plan review** → `docs/superpowers/plans/2026-11-22-review-pr-workspace-tabs-review.md`; implementation prerequisites for the user-supplied tab/split design, including early job acceptance, per-workspace draft state, shell isolation, mapping-to-Ask session lifecycle, and persisted tab migration. Accepted corrections are implemented in `2026-11-22-review-pr-workspace-tabs.md`; 16 corrected/source boards include preparation, failure and ended states. `ReviewUIContext` scopes draft/navigation state and remembers observed head across remounts. Native test fixture covers the actual tab shell with real Monaco.
- **Bitbucket description formatting** → `normalizeBitbucketDescription` in `main/atlassian/bitbucket.ts` removes known editor layout/card annotations outside Markdown code; `tests/bitbucket-api.test.ts` protects links, fences, inline code, escapes, and unknown attributes.
- **Fast PR opening / lazy agent checkout** → `main/ai-review/review-workspace-preparation.ts` separates DB-only `getOrCreateReviewRecord` from bounded agent preparation; `review-path/runtime.ts` prepares before launch, never in the project checkout. `review-explanation/workspace-root.ts` keeps review snapshots on the shared repository root across agent checkout creation. `renderer/lib/open-pr-review.ts` fences expired navigation.
- **Reading-path dev startup / idle polling / PR overview** → `main/db/startup-migrations.ts` repairs only missing reading-path tables hidden by another branch's newer migration timestamp; `renderer/lib/review-path-source.ts` shares one poller and preserves unchanged references; `ReviewPRSidebar.tsx` provides Needs review, Waiting and authored PRs with persistent filters; the old AllPRsDrawer remains only for standalone compatibility tests. Live integration evidence → `docs/superpowers/plans/2026-11-22-pr-reading-dev-repair.md`.
- **PR fetch stalls / transfer progress** → `main/review-explanation/fetch-process.ts` streams whitelisted Git counters with 120s inactivity and 10min absolute limits; `revision-acquisition.ts` seeds credential-isolated negotiation from all local branch tips and preserves shallow boundaries without editing source refs/config. Metadata/auth remain 60s, acquisition 12min, preparation 13min. `ReviewPathStorage.reportRunFetchProgress` fences/throttles/coalesces updates shown in `ReviewAgentTab`. Regressions: `review-fetch-process`, `review-revision-acquisition`, `review-revision-fetch-errors`, `review-agent-jobs`, `review-workspace-opening`.
- **Bitbucket abbreviated revisions / missing local objects** → `main/atlassian/bitbucket.ts` expands captured hashes in each side's repository; `main/review-explanation/revision-acquisition.ts` acquires exact objects separately from local-only snapshot reads. `renderer/lib/snapshot-acquisition.ts` bounds retries to explicit refresh; runtime Map uses the same acquisition boundary.
- **Explainable PR review investigation** → `.hermes/plans/2026-11-10_18-55-explainable-pr-review-investigation.md`; current PR ordering comes from `review-mode/useReviewData.ts`, branch-based diff reads from `review-mode/views/ChangesView.tsx`, and local viewed state from `main/trpc/routers/github.ts`. Proposal covers revision-pinned flows, architectural Q&A, and progress reconciliation.
- **Reading-path head ordering and task authority** → `src/main/review-path/application.ts` and `storage.ts` reserve/compare durable per-scope metadata generations across fresh request instances; `peek` is read-only. Invalid task credentials fail closed in `src/main/control-plane/server.ts`. Context ownership/recovery and bounded verification → `docs/superpowers/plans/2026-11-21-pr-reading-state-authority-fixes.md`.
- **Immutable review snapshots** → `src/main/review-explanation/snapshot.ts`, `git-reader.ts`, `src/main/trpc/routers/review-explanation.ts`; registered-workspace, local-object reads use full commit IDs and preserve absent/omitted/unavailable states. Tests: `tests/review-snapshot*.test.ts`; focused types: `tests/tsconfig.review-snapshot.json`. Flows/UI/Q&A are subsequent increments in `.hermes/plans/2026-11-10_19-35-explainable-pr-review-implementation.md`.
- **DB schema + migrations** → `src/main/db/` (auto-applied on startup via `initializeDatabase()`). **Always name migrations descriptively** — use `bun run db:generate --name <descriptive_name>` (e.g., `add_review_viewed_table`, not the default timestamped auto-name).

## Code Style

- **Biome** for formatting and linting (not ESLint/Prettier)
- Tabs for indentation, line width 100
- Double quotes, semicolons, ES5 trailing commas
- `noExplicitAny`: warn, `useConst`: error, `noNonNullAssertion`: warn
- Strict TypeScript: `strictNullChecks`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`

## Never Do This

- **Never add `Co-Authored-By` trailers to commit messages.**
- **Never commit `.env` files or OAuth secrets.** Only `.env.example` belongs in the repo.
- **Never run `git push --force` to `main`.**
- **Never bypass pre-commit hooks** with `--no-verify`.
- **Never install ESLint or Prettier.** Use Biome exclusively.
- **Never use `npm` or `yarn`.** Use Bun.
- **Renderer↔main IPC:** All renderer-initiated communication goes through preload + tRPC. Push-from-main event channels (e.g. `agent:alert`, `agent-confirm:*`, `agent-dispatch:*`) are the documented exception — they are wired via `contextBridge` in the preload and live in `src/main/control-plane/confirm-bridge.ts` and adjacent files.
- **Never store tokens or secrets in plain text.** Encrypt via Electron `safeStorage`.

## Maintenance

When you discover something non-obvious that required reading 2+ files to piece together, or the user corrects a wrong assumption — add a brief index entry above and commit: `git add CLAUDE.md && git commit -m 'docs: update CLAUDE.md'`. Only add at 95%+ confidence the fact is non-obvious, correct, and durable. Remove stale entries. Never explain — route to source.

## graphify

This project has a graphify knowledge graph at graphify-out/. The god nodes and community summary are **pre-loaded into context at session start** via a SessionStart hook.

Rules:
- **NEVER use Glob or Grep to find files.** Use the knowledge graph to identify which files to read, then Read them directly.
- Start all codebase exploration from `graphify-out/GRAPH_REPORT.md` — it is already in your context.
- For node detail (including file path), navigate `graphify-out/obsidian/<NodeName>.md` — then Read the source file.
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
