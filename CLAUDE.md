# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BranchFlux is an Electron desktop app for Git workflow management with Jira and Bitbucket (Atlassian) integration. It provides a terminal multiplexer for managing workspaces, branches, and worktrees within Git repositories.

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

### Monorepo Structure

Bun workspaces with Turbo orchestration. Primary app lives in `apps/desktop/`, shared TypeScript configs in `tooling/typescript/`.

### Electron Process Separation

Three isolated TypeScript contexts, each with its own tsconfig:

- **Main process** (`src/main/`) — Node.js context: DB, Git ops, tRPC server, Atlassian OAuth, terminal PTY spawning via node-pty
- **Renderer** (`src/renderer/`) — React 19 browser context: UI components, stores, tRPC client. Path alias `@/` maps to `src/renderer/`
- **Preload** (`src/preload/`) — IPC bridge exposing `window.electron` API with namespaces: `terminal`, `trpc`, `dialog`, `session`, `shell`

### Data Flow: tRPC over Electron IPC

The renderer communicates with main via tRPC transported over Electron IPC (not HTTP). The custom `ipcLink` in both processes handles serialization with superjson. The router lives in `src/main/trpc/routers/` and is composed in `src/main/trpc/index.ts`.

### State Management

- **Zustand** stores (`src/renderer/stores/`) — client-side UI state (terminal tabs, project selection)
- **TanStack Query** — server state caching for tRPC queries (Atlassian data, project lists)
- **SQLite + Drizzle ORM** (`src/main/db/`) — persistent storage. Schema in `schema.ts`, migrations in `migrations/`. WAL mode, foreign keys enforced. Migrations auto-apply on startup via `initializeDatabase()`

### Atlassian Integration

OAuth 2.0 flow using a localhost callback server on port 27391. Tokens encrypted with Electron `safeStorage` (OS keychain). Code organized in `src/main/atlassian/`: `auth.ts` (token CRUD + refresh), `oauth-flow.ts` (authorization flow), `jira.ts` and `bitbucket.ts` (API wrappers). OAuth client credentials injected at build time from `.env` via `electron.vite.config.ts` define blocks.

### Build System

Electron Vite (`electron.vite.config.ts`) builds all three processes. Main and preload use Rollup with `externalizeDepsPlugin()`. A custom `copyMigrationsPlugin()` copies Drizzle migration files to the output directory. Renderer uses Vite with React and Tailwind CSS v4.

## Code Style

- **Biome** for formatting and linting (not ESLint/Prettier)
- Tabs for indentation, line width 100
- Double quotes, semicolons, ES5 trailing commas
- `noExplicitAny`: warn, `useConst`: error, `noNonNullAssertion`: warn
- Strict TypeScript: `strictNullChecks`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`

## Never Do This

- **Never add `Co-Authored-By` trailers to commit messages.** No Claude attribution, no AI co-author lines. Commits are authored solely by the developer.
- **Never commit `.env` files or OAuth secrets.** Only `.env.example` (with placeholder values) belongs in the repo.
- **Never run `git push --force` to `main`.** Force-pushing to shared branches destroys history.
- **Never bypass pre-commit hooks** with `--no-verify`. Fix the underlying issue instead.
- **Never install ESLint or Prettier.** This project uses Biome exclusively for linting and formatting.
- **Never use `npm` or `yarn`.** This project uses Bun. Running other package managers will create conflicting lock files.
- **Never expose IPC channels directly.** All renderer-to-main communication goes through the preload bridge and tRPC. Do not add raw `ipcRenderer.send`/`ipcRenderer.on` calls in renderer code.
- **Never store tokens or secrets in plain text.** All credentials must be encrypted via Electron `safeStorage`.

## Design System

Dark theme with CSS custom properties defined in `src/renderer/styles.css`. Background levels: `--bg-base` through `--bg-overlay`. Text levels: `--text` through `--text-quaternary`. Accent: `--accent` (#0a84ff). Terminal uses custom ANSI color palette via xterm.js.
