# Orchestrator Memory — Design

Date: 2026-05-16
Branch: `orchestrator-memory`
Status: Approved (brainstorm phase complete, plan pending)

## Goal

Give orchestrator workspaces durable, project-scoped memory so they can act as a
personal assistant / project manager across sessions. The orchestrator should
remember what is being built, what still needs to happen, what was decided and
why, and what follow-ups are outstanding.

## Scope

In:

- Project-scoped persistent memory (goals, follow-ups, decisions, open
  questions, free-form journal).
- MCP tools as the read/write interface for the orchestrator.
- Storage that survives across orchestrator sessions and worktree churn.
- FTS5 full-text search over the prose portions of memory.

Out (v1, explicitly deferred):

- Cross-project / global memory.
- Vector embeddings and RAG.
- Auto-extraction from events, commits, or PRs.
- UI for browsing / editing memory (MCP-only first).
- Slack / Teams / Linear ingestion adapters.
- Use of the `graphify` Python tool as a runtime dependency.

## Non-goals

- Replacing existing live workspace state. `workspaces.currentPhase`,
  `statusText`, `needs`, the `agentMessages` table, and the per-worktree
  `.ss-events.jsonl` log all remain unchanged. Memory complements them, not
  replaces them.
- Building a generic note-taking app. The schema and tool surface are tuned
  for orchestrator project-management use.

## Background

- App-wide MCP support was just added (`mcp-standalone/`, launched with
  `ELECTRON_RUN_AS_NODE=1`).
- Orchestrator mode exists: `workspaces.isOrchestrator`, event sink writing
  `.ss-events.jsonl` into the orchestrator worktree, agent-coordination fields
  on `workspaces` (migration `0041_add_agent_coordination_fields.sql`).
- Existing storage does not cover: cross-session goals, follow-ups with due
  dates / owners, decisions with rationale, open questions, or free-form
  narrative.

## Architecture

Single backing module at `src/main/memory/` exposed through the existing
MCP server in `mcp-standalone/`.

Two stores:

1. **SQLite** (existing app DB, new tables) — typed records: goals,
   follow-ups, decisions, open questions, plus a journal index row.
2. **Filesystem** (Electron `app.getPath('userData')`) — one Markdown journal
   file per orchestrator session, freeform prose written by the orchestrator.

Search:

- Structured queries on the SQL tables (status, due date, owner, etc.).
- FTS5 virtual table over the prose fields of goals, decisions, open
  questions, and journal summaries.

Delivery model: **pull-only via MCP**. Nothing is auto-injected into the
orchestrator's context. The orchestrator decides when to read or write.

```
┌─ orchestrator (Claude / Codex / etc.) ──────────────┐
│   pulls + writes via MCP calls                       │
└───────────┬─────────────────────────────────────────┘
            │ MCP (mcp-standalone)
            ▼
   ┌──── src/main/memory/ ────┐
   │  read/write API           │
   │  FTS5 sync                │
   └────┬───────────────┬──────┘
        │               │
        ▼               ▼
   SQLite (app DB)   ~/.../<userData>/memory/<projectId>/journal/*.md
```

## Storage — SQLite schema

New migration: `0043_orchestrator_memory.sql`. Generate with
`bun run db:generate --name orchestrator_memory`.

```sql
CREATE TABLE memory_goals (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT,
  status      TEXT NOT NULL DEFAULT 'active', -- active|done|abandoned
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX memory_goals_project_status_idx
  ON memory_goals(project_id, status);

CREATE TABLE memory_followups (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  goal_id     TEXT REFERENCES memory_goals(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  owner       TEXT,    -- free text: 'user' | 'orchestrator' | workspace name
  due_at      INTEGER, -- nullable
  status      TEXT NOT NULL DEFAULT 'open', -- open|done|cancelled
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX memory_followups_project_status_idx
  ON memory_followups(project_id, status);
CREATE INDEX memory_followups_project_due_idx
  ON memory_followups(project_id, due_at);

CREATE TABLE memory_decisions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  rationale     TEXT NOT NULL,
  alternatives  TEXT, -- prose: what was rejected and why
  created_at    INTEGER NOT NULL
);
CREATE INDEX memory_decisions_project_idx
  ON memory_decisions(project_id, created_at);

CREATE TABLE memory_open_questions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  context      TEXT,
  status       TEXT NOT NULL DEFAULT 'open', -- open|answered|stale
  answer       TEXT,
  created_at   INTEGER NOT NULL,
  answered_at  INTEGER
);
CREATE INDEX memory_questions_project_status_idx
  ON memory_open_questions(project_id, status);

CREATE TABLE memory_journal (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL, -- orchestrator session uuid
  file_path   TEXT NOT NULL, -- absolute path to MD file on disk
  summary     TEXT,          -- one-liner orchestrator writes at journal_end
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER
);
CREATE INDEX memory_journal_project_idx
  ON memory_journal(project_id, started_at);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  kind,                   -- 'goal' | 'decision' | 'question' | 'journal'
  ref_id,                 -- id of source row
  project_id UNINDEXED,
  body,
  tokenize = 'porter unicode61'
);
```

FTS5 sync strategy: application-level dual-write inside a single transaction
in the memory module. Triggers are intentionally avoided so the sync path is
visible in TypeScript and easy to test. The `body` column packs the
searchable text:

- goals: `title + "\n\n" + body`
- decisions: `title + "\n\n" + rationale + "\n\n" + alternatives`
- questions: `question + "\n\n" + context + "\n\n" + answer`
- journal: `summary` (journal MD file body is not indexed in FTS5 v1;
  see Open Risks)

## Storage — Filesystem (journal)

Path:

```
<userData>/memory/<projectId>/journal/YYYY-MM-DD-HHMMSS-<sessionId>.md
```

`<userData>` resolves to `app.getPath('userData')` in the main process and is
passed through to the daemon / MCP server via the existing
`SUPERIORSWARM_*` environment variables (extend with
`SUPERIORSWARM_MEMORY_PATH`).

One file per orchestrator session. File granularity matches a single
orchestrator "shift" — cleaner boundaries than per-day, at the cost of more
files. Files are append-only during the session and frozen on `journal_end`.

Suggested file content (orchestrator chooses exact format):

```md
# Session 2026-05-16 14:32 (<sessionId>)

## Goal
Ship MCP support for the orchestrator.

## Did
- Merged `main` into `mcp-support-for-app`.
- Fixed `agent:alert` channel name in confirm-bridge.

## Blocked on
Nothing.

## Next
Hand off to user for QA.
```

The MD file is the source of truth for journal prose. The DB row is an index
(path, summary, timing) so list queries do not need to read the filesystem.

## MCP tool surface

All tools take an implicit `project_id` resolved by the MCP server from the
caller's cwd → workspace → project chain. Tools live in
`mcp-standalone/` and route to `src/main/memory/` over IPC.

Writes:

```ts
memory.add_goal({ title, body?: })             -> { id }
memory.update_goal({ id, status?, title?, body? })

memory.add_followup({
  title, body?, owner?, due_at?, goal_id?
}) -> { id }
memory.update_followup({ id, status?, title?, body?, owner?, due_at?, goal_id? })

memory.log_decision({ title, rationale, alternatives? }) -> { id }

memory.add_question({ question, context? }) -> { id }
memory.answer_question({ id, answer })

memory.journal_start() -> { session_id, file_path }
memory.journal_append({ session_id, text })   // appends to the MD file
memory.journal_end({ session_id, summary })   // freezes file, sets summary + FTS
```

Reads:

```ts
memory.list_goals({ status?: 'active'|'done'|'abandoned' })
memory.list_followups({
  status?: 'open'|'done'|'cancelled',
  owner?, due_before?, due_after?
})
memory.list_decisions({ limit?, since? })
memory.list_questions({ status?: 'open'|'answered'|'stale' })
memory.recent_journals({ limit })             // index rows: id, summary, path, started_at
memory.read_journal({ session_id })           // returns MD body
memory.search({ query, kinds?: ('goal'|'decision'|'question'|'journal')[] })
```

Tool count is ~14. Acceptable because the orchestrator (model) is expected
to pick the right tool; flatness beats nesting for tool calling.

## Read / write flow

Write:

1. Orchestrator calls e.g. `memory.add_followup(...)`.
2. MCP server forwards to `src/main/memory/`.
3. Memory module: `INSERT` into the typed table + matching `INSERT` into
   `memory_fts` inside one transaction. Updates do an FTS `DELETE` +
   `INSERT` on the same `(kind, ref_id)` key.
4. For `journal_append`, the memory module appends to the MD file on disk
   (no DB write on each append). `journal_end` updates the
   `memory_journal` row and inserts the summary into FTS.

Read:

1. Orchestrator calls e.g. `memory.list_followups({ due_before: now })`.
2. Memory module runs the SQL filter, returns rows as JSON.
3. `memory.search` runs FTS5 `MATCH`, joins back to the source tables,
   returns ranked rows with snippets.

## Module layout

```
apps/desktop/src/main/memory/
  index.ts          # public API used by trpc + mcp glue
  schema.ts         # drizzle schema for memory_* tables
  fts.ts            # FTS5 sync helpers (insert/update/delete)
  journal.ts        # filesystem journal writer/reader
  paths.ts          # userData → memory root resolver
  ids.ts            # id generation (reuse existing util if present)

apps/desktop/src/main/db/migrations/
  0043_orchestrator_memory.sql

mcp-standalone/
  tools/memory.ts   # MCP tool definitions calling into main via IPC
```

`memory_*` tables go in a new `schema-memory.ts` re-exported from
`apps/desktop/src/main/db/schema.ts` (mirrors the existing
`schema-ai-review.ts` / `schema-comment-solver.ts` split).

## Coordination with existing systems

| Existing                       | Role                              | Change |
|--------------------------------|-----------------------------------|--------|
| `workspaces.currentPhase`      | Live workspace status             | None   |
| `workspaces.statusText/needs`  | Live workspace status detail      | None   |
| `agentMessages`                | Inter-workspace comms             | None   |
| `.ss-events.jsonl` (worktree)  | Raw event log for orchestrator    | None   |
| MCP server (`mcp-standalone/`) | Tool host                         | Add memory tools |

Future (not v1): the orchestrator may choose to summarise recent
`.ss-events.jsonl` entries into a journal append. That stays a model-level
behaviour, not infrastructure.

## Testing

- Unit tests in `apps/desktop/tests/memory.test.ts` covering:
  - CRUD on each table.
  - FTS5 dual-write keeps `memory_fts` consistent across insert, update,
    delete.
  - `memory.search` returns ranked snippets and respects `kinds` filter.
  - Journal start/append/end writes the MD file in the right location and
    sets `ended_at` + `summary` correctly.
  - Project deletion cascades correctly (ON DELETE CASCADE).
- MCP integration test that boots `mcp-standalone/` and exercises one
  read + one write tool.

## Risks and mitigations

- **FTS5 drift.** Application-level dual-write can desync if a code path
  forgets to update FTS. Mitigation: centralize all FTS writes in
  `src/main/memory/fts.ts`; no other module touches `memory_fts`.
  Add a rebuild helper for recovery.
- **Journal MD body not in FTS5.** Searching journals only matches on
  `summary`. Acceptable v1 because summaries are model-written and
  intentionally concise. If recall quality is poor in practice, follow-up
  is to ingest MD body on `journal_end` into a second FTS row keyed
  `kind='journal_body'`.
- **Tool count fatigue.** ~14 tools is borderline. If real use shows the
  model picks wrong tools, collapse `add_*` / `update_*` pairs into
  upserts.
- **Cross-process file paths.** Daemon and MCP server need
  `<userData>/memory` resolved consistently. Pass via
  `SUPERIORSWARM_MEMORY_PATH` alongside the existing
  `SUPERIORSWARM_*` env vars in `electron.vite.config.ts` / spawn sites.
- **Schema lock-in.** Adding a 6th memory kind later is a migration.
  Acceptable; the kinds chosen (goals, follow-ups, decisions, questions,
  journal) cover the stated PM-style use case.

## Open questions (deferred, not blockers)

- Whether to expose memory in the renderer UI eventually (PM dashboard).
- Whether to share memory across orchestrator-mode workspaces of the same
  project, or scope per orchestrator (current design: project-scoped,
  shared).
- Retention / pruning policy for old journals.

## Acceptance criteria

- Orchestrator can, from a fresh session, call
  `memory.recent_journals` + `memory.list_followups({ status: 'open' })`
  and get back project-scoped state written in a previous session.
- All five typed kinds are writable, updatable, and searchable.
- `memory.search('auth')` returns results spanning goals, decisions,
  questions, and journal summaries, ranked by FTS5 BM25.
- Tests cover CRUD + FTS sync + journal file lifecycle.
- No regressions in existing orchestrator event sink or agent messages.
