# CLAUDE.md Lean Index + Self-Updating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current verbose CLAUDE.md with a lean index format and wire a PostToolUse hook that auto-commits any Claude edits to it.

**Architecture:** Two file changes — rewrite `CLAUDE.md` to ~65 lines using index format, then create `.claude/settings.json` with a PostToolUse hook that detects and commits CLAUDE.md changes after every Edit/Write tool call.

**Tech Stack:** Git hooks via Claude Code `settings.json`. No new dependencies.

---

## Files

- Modify: `CLAUDE.md` (root)
- Create: `.claude/settings.json`

---

### Task 1: Rewrite CLAUDE.md as a lean index

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace CLAUDE.md with the lean index version**

Overwrite the entire file with:

```markdown
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

## Architecture

- **Four processes:** main (`src/main/`) / daemon (`src/daemon/`) / renderer (`src/renderer/`) / preload (`src/preload/`)
- **Cross-process types** → `src/shared/` (define new types here, not inline in process code)
- **tRPC router** → `src/main/trpc/` (over Electron IPC via `ipcLink`, not HTTP)
- **Terminal PTY daemon** → `src/daemon/` (Unix socket; spawned with `SUPERIORSWARM_SOCKET_PATH`, `_DB_PATH`, `_DEV_MODE`)
- **Build-time env injection** → `electron.vite.config.ts` `define` block (OAuth + Supabase credentials are NOT in runtime `process.env`)
- **MCP server** → `mcp-standalone/` (native modules rebuilt against Electron ABI; launched via `ELECTRON_RUN_AS_NODE=1`)
- **DB schema + migrations** → `src/main/db/` (auto-applied on startup via `initializeDatabase()`)

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
- **Never expose IPC channels directly.** All renderer↔main communication goes through preload + tRPC.
- **Never store tokens or secrets in plain text.** Encrypt via Electron `safeStorage`.

## Maintenance

When you discover something non-obvious that required reading 2+ files to piece together, or the user corrects a wrong assumption — add a brief index entry above and commit: `git add CLAUDE.md && git commit -m 'docs: update CLAUDE.md'`. Only add at 95%+ confidence the fact is non-obvious, correct, and durable. Remove stale entries. Never explain — route to source.
```

- [ ] **Step 2: Verify line count**

```bash
wc -l CLAUDE.md
```

Expected: ≤ 70 lines.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite CLAUDE.md as lean index"
```

---

### Task 2: Create `.claude/settings.json` with PostToolUse hook

**Files:**
- Create: `.claude/settings.json`

- [ ] **Step 1: Create settings.json**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "git -C \"$(git rev-parse --show-toplevel)\" diff --name-only -- CLAUDE.md | grep -q . && git -C \"$(git rev-parse --show-toplevel)\" add CLAUDE.md && git -C \"$(git rev-parse --show-toplevel)\" commit -m 'docs: update CLAUDE.md'"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Verify the hook fires**

Make a trivial edit to CLAUDE.md (add a space, then remove it) using the Edit tool, then confirm a new commit appeared:

```bash
git log --oneline -3
```

Expected: top commit is `docs: update CLAUDE.md`.

- [ ] **Step 3: Verify the hook is silent when CLAUDE.md is unchanged**

Make an edit to any other file (e.g. add a comment to a test file, then revert it). Confirm no spurious CLAUDE.md commit appears:

```bash
git log --oneline -3
```

Expected: no new `docs: update CLAUDE.md` commit.

- [ ] **Step 4: Commit settings.json**

```bash
git add .claude/settings.json
git commit -m "chore: add PostToolUse hook to auto-commit CLAUDE.md edits"
```
