# CLAUDE.md: Lean Index + Self-Updating Design

**Date:** 2026-04-09  
**Goal:** Keep CLAUDE.md lean (lower token usage) and accurate (auto-updated by Claude during sessions).

---

## Core Principle: Index, Not Manual

CLAUDE.md is a routing layer. Each entry answers: *"where does more data live?"* — not *"what is the full explanation?"*

**Wrong:** "The daemon subprocess communicates with main over a Unix socket at `~/.superiorswarm/daemon.sock`, spawned with env vars `SUPERIORSWARM_SOCKET_PATH`..."  
**Right:** "Terminal PTY daemon → `src/daemon/` (Unix socket; env: `SUPERIORSWARM_SOCKET_PATH`, `_DB_PATH`, `_DEV_MODE`)"

The index entry flags the non-obvious part and points to where details live.

---

## What CLAUDE.md Contains

Five fixed sections — all brief:

### 1. Tech Stack
One-liner so Claude doesn't have to infer it:
> Electron + React 19 + TypeScript. Bun (runtime + package manager). Turbo (monorepo). tRPC over IPC. SQLite + Drizzle ORM. Biome (lint/format). xterm.js + node-pty (terminal).

### 2. Build Commands
Unchanged. Non-obvious because of the Turbo + Bun interplay and `apps/desktop/` split.

### 3. Architecture Index
Short entries pointing to where things live. Each entry: what it is (1–5 words) → where it lives → non-obvious part only (1 sentence max).

Example entries:
- Four processes: main / daemon / renderer / preload
- Cross-process types → `src/shared/` (define new types here, not inline in process code)
- tRPC router → `src/main/trpc/` (over Electron IPC, not HTTP — use `ipcLink`)
- Build-time env injection → `electron.vite.config.ts` `define` block (not runtime `process.env`)
- MCP server → `mcp-standalone/` (native modules rebuilt against Electron ABI; `ELECTRON_RUN_AS_NODE=1`)

### 4. Coding Conventions
Biome config summary — already brief. Kept as-is.

### 5. Never Do This
Rules block — unchanged.

---

## Self-Update Protocol

### The 95% Confidence Rule

Claude only adds an entry when 95%+ confident that:
1. The fact is **non-obvious** — required reading 2+ files, not inferrable from structure alone
2. The fact is **correct** — not speculative or session-specific
3. The fact is **durable** — architectural, not ephemeral task context

When in doubt, don't add it.

### Triggers
- User corrects a wrong assumption Claude made → update or remove the wrong entry
- Claude discovers something non-obvious while working → add a brief index entry
- An entry in the file becomes inaccurate → update or remove it

### Format
Index format only — no prose. Route to source, don't explain it.

### What NOT to Add
- Anything discoverable from a single file read
- Full explanations (code has the details — point there)
- In-progress task context or ephemeral state
- User preferences / workflow notes (those go in `.claude/projects/memory/`)

### Commit
```
git add CLAUDE.md && git commit -m 'docs: update CLAUDE.md'
```

---

## PostToolUse Hook

Added to `.claude/settings.json`. After every `Edit` or `Write`, checks if CLAUDE.md has uncommitted changes and auto-commits:

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

Cheap — single `git diff` per edit. Commits only when CLAUDE.md changed. Never uses `--no-verify`.

---

## Target CLAUDE.md Shape

```
# CLAUDE.md
[one-line: what this file is]

## Tech Stack
[one-liner]

## Commands
[commands block]

## Architecture
[index entries — 1 line each]

## Code Style
[biome settings]

## Never Do This
[rules]

## Maintenance
[self-update protocol — 4 sentences]
```

Target: ~60–70 lines. No prose. No full explanations.

---

## Out of Scope
- Scripted extraction from source files
- Splitting CLAUDE.md into multiple files
- Any CI/CD automation
