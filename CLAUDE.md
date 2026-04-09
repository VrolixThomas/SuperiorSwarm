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
