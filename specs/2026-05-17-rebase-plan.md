# Rebase `orchestrator-memory` onto latest `main`

**Goal:** Replay our 17 memory-feature commits onto `origin/main` (now at `20693452`), then re-wire MCP exposure to the new control-plane HTTP pattern. Memory TS facade and 54 module tests stay intact; only the MCP layer (`mcp-config.ts`, `index.ts` env wiring, `server.mjs` memory tools, MCP smoke test) gets re-implemented.

**Architecture pivot:** Memory tools become control-plane HTTP callers (Option A, chosen). Single DB writer = main process. No second `better-sqlite3` connection from `server.mjs`. Matches `set_status` / `send_message` / `read_messages` pattern.

## Divergence summary

Base of branch: `ad4f82b3`. `origin/main` HEAD: `20693452` (v0.9.1).

Main introduced (relevant to us):
- `4c0f80bd feat: boot-time global MCP install + migration` — added `0043_global_mcp_install.sql` (collides with our `0043_orchestrator_memory.sql`).
- `16fdd99a refactor: remove per-worktree .mcp.json writers` — deleted `apps/desktop/src/main/services/mcp-config.ts` and its test; stripped `mcpEnvProvider`/`writeWorkspaceMcpJson` from `workspace-service.ts`.
- `cccb01e8 fix: deliver orchestrator coordination via MCP, store events outside worktree` — rewrote `apps/desktop/mcp-standalone/server.mjs` to:
  - Read `control.json` from default userData dir.
  - Call `GET /context.resolve?cwd=<cwd>` for mode/projectId/workspaceId/`modeContext`.
  - `modeContext` is `{}` for `workspace-agent` mode — no `dbPath`/`memoryRoot` exposed.
- `f96ae249 Merge #105 global-mcp-tool` — added `global-mcp-launcher.ts`, `global-mcp-install.ts`, `global-mcp-migration.ts`, `mcp-config-merge.ts`, related tests, and trpc router `global-mcp.ts`.

Our 17 commits on branch, grouped:
- **Module/facade (no conflicts expected):** `c7e0803f`, `aab77990`, `d35298a8`, `b3e8e101`, `6486ce5e`, `812912fe`, `cb4fdead`, `cd58982f`, `68dde1d2`.
- **Migration (file-name collision):** `b089ee92`, `e2e21898`.
- **Cross-process tests (file-only conflicts):** `aad55c42`.
- **MCP wiring (rewrite required):** `f7dab065`, `32d94c51`.
- **Docs (text merge):** `b6bfbb92`, `add6aae0`.
- **Plan/spec doc:** `2b65e1ad`.

---

## Phase 0 — Pre-flight (no destructive ops)

- [ ] Verify clean tree: `git status` → "nothing to commit, working tree clean"
- [ ] Push branch as safety backup: `git push -u origin orchestrator-memory:orchestrator-memory-pre-rebase` (one-shot; treat as a snapshot we can `git reset --hard` to)
- [ ] Confirm memory tests pass on current branch tip:
  ```bash
  cd apps/desktop && bun test tests/memory
  ```
  Expected: `54 pass, 0 fail`.
- [ ] Snapshot SHAs for the rewrite (Phase C): write into a scratch note —
  - `f7dab065` (MCP server tools commit, contains 15 tool registrations + env-based DB open)
  - `32d94c51` (static-analysis smoke test)
  - `aad55c42` (cascade test using direct SQLite — verify still valid post-rewrite)

---

## Phase A — Renumber our migration ahead of rebase

Cleanest done **before** rebase so the file-rename is captured in our own commits, not as a conflict resolution.

- [ ] Rename file:
  ```bash
  git mv apps/desktop/src/main/db/migrations/0043_orchestrator_memory.sql \
         apps/desktop/src/main/db/migrations/0044_orchestrator_memory.sql
  ```
- [ ] Edit `apps/desktop/src/main/db/migrations/meta/_journal.json`: change the entry `"idx": 43, "tag": "0043_orchestrator_memory"` to `"idx": 44, "tag": "0044_orchestrator_memory"`. Leave `when` untouched.
- [ ] Update any code references that hard-code the old filename. Grep:
  ```bash
  rg "0043_orchestrator_memory" -l
  ```
  Likely hits: `apps/desktop/tests/memory/migration.test.ts`. Update string in place.
- [ ] Run migration + tests sanity:
  ```bash
  cd apps/desktop && bun test tests/memory
  ```
  Expected: still 54 pass.
- [ ] Commit:
  ```bash
  git commit -am "chore(memory): renumber migration to 0044 (avoid 0043 collision with global_mcp_install)"
  ```

Resulting branch: 18 commits ahead of base, last commit is the rename.

---

## Phase B — Rebase

- [ ] Run:
  ```bash
  git rebase origin/main
  ```
- [ ] **Per-commit expected resolutions:**

  **Plan/spec doc `2b65e1ad`** — clean replay, no conflict.

  **Schema `c7e0803f`** — clean (`schema.ts` only appends a re-export; verify no concurrent edit on main). If `schema.ts` was edited on main, accept theirs + re-append `export * from "./schema-memory";` at the bottom. `git add` + `git rebase --continue`.

  **Migration commits `b089ee92`, `e2e21898`** — the file is already `0044_*.sql` on our side after Phase A. The `_journal.json` entry will likely conflict because main added idx=43 and we have idx=44 referring to the same position. Resolution: keep **both** journal entries (main's `0043_global_mcp_install` and ours `0044_orchestrator_memory`), array order ascending by `idx`. Trailing-newline fix replays cleanly on the renamed file.

  **Module commits (`aab77990` → `68dde1d2`)** — all add brand-new files under `apps/desktop/src/main/memory/`. Should replay cleanly. If any commit's index touches `index.ts` of an existing folder, resolve by accepting both sides additively.

  **MCP wiring `f7dab065`** — **this commit will conflict heavily and must not be naively merged.** Steps:
  1. When rebase stops, run `git status`. Expect:
     - `deleted by them: apps/desktop/src/main/services/mcp-config.ts` — resolve: `git rm apps/desktop/src/main/services/mcp-config.ts`. Our edits to that file are dropped here; the new wiring lives in Phase C.
     - `both modified: apps/desktop/mcp-standalone/server.mjs` — resolve: **accept theirs entirely** (`git checkout --theirs apps/desktop/mcp-standalone/server.mjs`). Our memory-tool registrations and env-based DB open are dropped here; Phase C re-adds them as HTTP callers.
     - `both modified: apps/desktop/src/main/index.ts` — resolve: accept theirs; the `dbPath`/`memoryRoot` additions to `baseEnv` are obsolete (no `.mcp.json` writer anymore).
     - `both modified: apps/desktop/src/main/db/index.ts` — our change made `getDbPath` exported. Check if main also touched this export. If `getDbPath` is now used elsewhere in main, keep it exported; if it's never used outside the file, accept theirs and drop our export change (no longer needed — Phase C reads DB via `getDb()`).
  2. `git add` resolved files; `git rebase --continue`.
  3. The resulting commit will be an empty-ish no-op containing only Phase-C-deferred work. Edit message to: `chore(memory): drop env-based MCP wiring (superseded by control-plane HTTP, see follow-up)`.

  **Cascade test `aad55c42`** — its setup may use `better-sqlite3` directly inside the test process (per the `preload-electron-mock` shim). That keeps working post-rewrite. If it imports from `mcp-config.ts` (it shouldn't), fix imports. Verify by running it after rebase completes.

  **Smoke test `32d94c51`** — reads `server.mjs` as text and asserts memory tool names + env vars. After Phase B step `f7dab065` accepts theirs, `server.mjs` has no memory tools. The assertions will fail. Two options:
  - Defer: when this commit replays, accept the test file changes verbatim (knowing it fails). Continue rebase. Fix in Phase C/D.
  - Or `git rm` the test file during conflict resolution and re-introduce it in Phase D.
  Recommend the first (defer) — keeps history linear, all assertion rewrites land together in Phase D.

  **Docs `b6bfbb92`, `add6aae0`** — likely conflict on `CLAUDE.md` because main added unrelated entries. Resolution: keep both sets, prefer chronological order matching the rest of the file.

- [ ] After `git rebase --continue` reports success:
  ```bash
  git log --oneline origin/main..HEAD
  ```
  Confirm 18 commits.
- [ ] `bun test tests/memory` will fail on `mcp-tools.test.ts` (expected) but module tests still pass. Note the failure count for Phase D.

---

## Phase C — Re-wire MCP layer via control-plane HTTP

All new work, single commit at the end of Phase C; no test edits yet.

### C.1 Add shared Zod schemas

**File:** `apps/desktop/src/shared/control-plane.ts` (existing — append at the end).

Schemas to add (one per MCP tool, request body shape only — responses are passthrough JSON):

```typescript
// Memory: goals
export const memoryAddGoalRequestSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(8192).optional(),
});
export const memoryListGoalsRequestSchema = z.object({
  status: z.enum(["open", "done", "abandoned"]).optional(),
});

// Memory: followups
export const memoryAddFollowupRequestSchema = z.object({
  title: z.string().min(1).max(500),
  goalId: z.string().optional(),
  owner: z.string().max(200).optional(),
  dueAt: z.number().int().optional(), // seconds since epoch
});
export const memoryListFollowupsRequestSchema = z.object({
  status: z.enum(["open", "done", "cancelled"]).optional(),
  owner: z.string().optional(),
  dueBefore: z.number().int().optional(),
  dueAfter: z.number().int().optional(),
});

// Memory: decisions
export const memoryLogDecisionRequestSchema = z.object({
  title: z.string().min(1).max(500),
  rationale: z.string().max(8192).optional(),
  alternatives: z.string().max(8192).optional(),
});
export const memoryListDecisionsRequestSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

// Memory: questions
export const memoryAddQuestionRequestSchema = z.object({
  question: z.string().min(1).max(2000),
});
export const memoryAnswerQuestionRequestSchema = z.object({
  questionId: z.string(),
  answer: z.string().min(1).max(8192),
});
export const memoryListQuestionsRequestSchema = z.object({
  status: z.enum(["open", "answered"]).optional(),
});

// Memory: journal
export const memoryJournalStartRequestSchema = z.object({
  sessionId: z.string(),
  title: z.string().max(500).optional(),
});
export const memoryJournalAppendRequestSchema = z.object({
  journalId: z.string(),
  body: z.string().min(1),
});
export const memoryJournalEndRequestSchema = z.object({
  journalId: z.string(),
  summary: z.string().max(8192).optional(),
});
export const memoryReadJournalRequestSchema = z.object({
  journalId: z.string(),
});
export const memoryRecentJournalsRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

// Memory: search
export const memorySearchRequestSchema = z.object({
  query: z.string().min(1),
  kinds: z.array(z.enum(["goal", "decision", "question", "journal"])).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
```

(Field names mirror the TS facade's current call shapes; cross-check against `goals.ts`/`followups.ts`/etc. when writing.)

### C.2 Add control-plane routes

**File:** `apps/desktop/src/main/control-plane/server.ts`.

Pattern (mirrors `setStatus`/`sendMessage`):

```typescript
case "POST /memory.add_goal": {
  const body = await readJson(req);
  const parsed = memoryAddGoalRequestSchema.safeParse(body);
  if (!parsed.success) {
    respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
    return;
  }
  const caller = resolveCaller(req, null);
  if ("error" in caller) {
    respond(res, 401, requestId, { error: "unauthorized" });
    return;
  }
  const userData = app.getPath("userData"); // see C.3 — inject, don't import app here
  respond(res, 200, requestId, memory.addGoal(caller.projectId, parsed.data));
  return;
}
```

Routes to add (15 total — match MCP tool surface):

| Method + path                       | Schema                                | Facade call                                       |
| ----------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `POST /memory.add_goal`             | `memoryAddGoalRequestSchema`          | `memory.addGoal(projectId, data)`                 |
| `GET  /memory.list_goals`           | `memoryListGoalsRequestSchema` (query params) | `memory.listGoals(projectId, opts)`       |
| `POST /memory.add_followup`         | `memoryAddFollowupRequestSchema`      | `memory.addFollowup(projectId, data)`             |
| `GET  /memory.list_followups`       | `memoryListFollowupsRequestSchema`    | `memory.listFollowups(projectId, opts)`           |
| `POST /memory.log_decision`         | `memoryLogDecisionRequestSchema`      | `memory.logDecision(projectId, data)`             |
| `GET  /memory.list_decisions`       | `memoryListDecisionsRequestSchema`    | `memory.listDecisions(projectId, opts)`           |
| `POST /memory.add_question`         | `memoryAddQuestionRequestSchema`      | `memory.addQuestion(projectId, data)`             |
| `POST /memory.answer_question`      | `memoryAnswerQuestionRequestSchema`   | `memory.answerQuestion(projectId, data)`          |
| `GET  /memory.list_questions`       | `memoryListQuestionsRequestSchema`    | `memory.listQuestions(projectId, opts)`           |
| `POST /memory.journal_start`        | `memoryJournalStartRequestSchema`     | `memory.journalStart({userDataPath, projectId, ...data})` |
| `POST /memory.journal_append`       | `memoryJournalAppendRequestSchema`    | `memory.journalAppend({userDataPath, projectId, ...data})` |
| `POST /memory.journal_end`          | `memoryJournalEndRequestSchema`       | `memory.journalEnd({userDataPath, projectId, ...data})`   |
| `GET  /memory.read_journal`         | `memoryReadJournalRequestSchema` (query) | `memory.readJournal({userDataPath, projectId, ...data})` |
| `GET  /memory.recent_journals`      | `memoryRecentJournalsRequestSchema` (query) | `memory.recentJournals({userDataPath, projectId, ...data})` |
| `GET  /memory.search`               | `memorySearchRequestSchema` (query)   | `memory.search({projectId, ...data})`             |

`resolveCaller(req, null)` already derives `projectId` from the `X-Workspace-Id` header — exactly what we need for project scoping.

### C.3 Inject userData into control-plane deps

`server.ts` mustn't `import { app } from "electron"` directly (it has no Electron dep). Add to `ControlPlaneDeps`:

```typescript
export interface ControlPlaneDeps {
  // ...existing
  userDataPath: string;
}
```

And in `apps/desktop/src/main/index.ts` where `startControlPlane({...})` is called, pass `userDataPath: app.getPath("userData")`.

### C.4 Re-add memory tools to `server.mjs`

**File:** `apps/desktop/mcp-standalone/server.mjs`. Inside the existing `if (isWorkspaceAgentMode) { ... }` block (the one with `set_status`, `send_message`, etc.), append 15 `server.tool(...)` registrations that delegate to `call("POST", "/memory.add_goal", body)` etc. Pattern (one example, repeat for each):

```javascript
server.tool(
  "memory_add_goal",
  "Record a new goal for this project.",
  {
    title: z.string().describe("Short goal title"),
    description: z.string().optional().describe("Longer prose description"),
  },
  async ({ title, description }) =>
    call("POST", "/memory.add_goal", { title, description })
);
```

`GET` tools use URLSearchParams (cf. `read_messages` pattern in the existing code).

No `PROJECT_ID` arg needed on any tool — control plane derives it from `X-Workspace-Id`.

### C.5 Commit Phase C

```bash
git add apps/desktop/src/shared/control-plane.ts \
        apps/desktop/src/main/control-plane/server.ts \
        apps/desktop/src/main/index.ts \
        apps/desktop/mcp-standalone/server.mjs
git commit -m "feat(memory): expose memory tools via control-plane HTTP

Replaces the env-passed DB_PATH/MEMORY_ROOT approach (dropped in
rebase). Memory MCP tools now call POST/GET /memory.* on the existing
control plane, matching the set_status/send_message pattern. Main
process is the single SQLite writer."
```

---

## Phase D — Update tests for new wiring

### D.1 Rewrite `mcp-tools.test.ts` (static-analysis smoke test)

`apps/desktop/tests/memory/mcp-tools.test.ts` currently asserts: `server.mjs` registers `memory_*` tool names, reads `DB_PATH` + `MEMORY_ROOT`, opens DB inside workspace-agent branch.

New assertions:
- 15 `memory_*` tool names present in `server.mjs` body.
- Each memory tool body contains `call("POST", "/memory.` or `call("GET", "/memory.`.
- No `Database(` call inside the workspace-agent branch (DB access moved to main process).
- No reads of `process.env.DB_PATH` or `process.env.MEMORY_ROOT`.

### D.2 Add control-plane route tests (replaces static-analysis as the integration check)

**File:** `apps/desktop/tests/control-plane/memory-routes.test.ts` (new).

Per route, exercise the HTTP layer in-process (the existing `tests/control-plane.test.ts` shows the pattern — `createControlPlaneServer({...})`, bind to port 0, fetch). Cover:
- `POST /memory.add_goal` round-trip: insert → read row in DB.
- `GET /memory.list_goals` returns the inserted goal scoped to the caller's project.
- 401 when `X-Workspace-Id` missing.
- 401 when workspace doesn't exist.
- 400 on invalid body.
- One journal route round-trip (writes MD file under `userDataPath/memory/<projectId>/journal/`).
- `GET /memory.search` returns hits after content is inserted via `POST /memory.add_goal`.

Use the same in-memory or temp-dir DB setup as `tests/control-plane.test.ts`.

### D.3 Run full memory test suite

```bash
cd apps/desktop && bun test tests/memory tests/control-plane
```

Expected: 54 module tests + smoke test (revised) + new memory-routes tests all pass.

### D.4 Commit Phase D

```bash
git commit -am "test(memory): update MCP smoke test + add control-plane route tests"
```

---

## Phase E — Final verification

- [ ] `bun run type-check` from repo root — expect clean.
- [ ] `bun run check` — Biome may format added files; commit those formatting fixes as `chore: biome format`.
- [ ] `bun test` at root — full suite green (modulo pre-existing failures on main, which we don't own).
- [ ] Manual smoke (optional but recommended):
  - `bun run dev`
  - In an orchestrator workspace, invoke `memory_add_goal` via the agent.
  - `sqlite3 ~/Library/Application\ Support/SuperiorSwarm/superiorswarm.db "SELECT * FROM memory_goals;"` — confirm row exists.
  - Confirm `~/Library/Application\ Support/SuperiorSwarm/memory/<projectId>/journal/` is created after `memory_journal_start`.
- [ ] Final branch tip should look like:
  ```
  feat(memory): expose memory tools via control-plane HTTP   ← Phase C
  test(memory): update MCP smoke test + add control-plane route tests  ← Phase D
  chore(memory): renumber migration to 0044                  ← Phase A
  docs: index orchestrator-memory module in CLAUDE.md        ← original
  ... (module + facade commits, untouched)
  ```
- [ ] Force-push (with safety): `git push --force-with-lease origin orchestrator-memory`.

---

## Risk register

| Risk                                                   | Likelihood | Mitigation                                                                                |
| ------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------- |
| `_journal.json` rebase conflict ordering mistake       | Medium     | Validate by running `bun run db:generate` after rebase; should report no pending changes. |
| Memory facade signatures don't accept `(projectId, ...)` everywhere | Medium  | Spot-check `goals.ts`, `followups.ts`, etc. during C.2; fix in same commit if needed.    |
| `app.getPath("userData")` not available at control-plane construction time | Low | Already passed at startup (line ~270 in `src/main/index.ts`); just thread through deps. |
| Drizzle migration order skips idx=43 if our rename lands first locally | Low | Migrations apply by `_journal.json` order, not filename — verify by inspection.     |
| Race between main-process DB write and Drizzle init    | Low        | Control plane starts after `initializeDatabase()` already (verify in `index.ts`).         |
| `mcp-tools.test.ts` rewrite drifts from actual route surface | Medium  | Use the 15-route table in C.2 as the single source of truth; reference it from the test. |

## Rollback

If anything goes catastrophically wrong mid-rebase:
```bash
git rebase --abort
git reset --hard orchestrator-memory-pre-rebase
```
(That's why Phase 0 pushes the backup branch.)
