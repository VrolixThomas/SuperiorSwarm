# Terminal Daemon Design

**Date:** 2026-03-05
**Branch:** background-deamon-terminals
**Status:** Approved, ready for implementation

## Problem

Terminal sessions are currently owned by the Electron main process via `node-pty`. When the app quits or crashes, all PTY processes are killed. On next launch, the app replays serialized xterm.js scrollback from SQLite to give the appearance of continuity, but the actual shell sessions (running processes, working directory state, in-flight commands) are lost.

The goal is to make terminals survive app quit and crashes — the PTY process keeps running in the background and the app reconnects to it on next launch.

## Target Platform

macOS only. Unix domain sockets, POSIX signals, and `ELECTRON_RUN_AS_NODE` are all available.

## Architecture

```
┌─────────────────────────────────────┐     ┌──────────────────────────────────┐
│         Electron App                │     │        Terminal Daemon           │
│                                     │     │   (independent process)          │
│  Renderer (xterm.js)                │     │                                  │
│      ↕ IPC (unchanged)              │     │  ┌─────────────────────────────┐ │
│  Main Process                       │     │  │  PTY Manager                │ │
│      └── DaemonClient ─────────────────→  │  │  node-pty processes         │ │
│           Unix socket client        │  ←──│  │  one per terminal ID        │ │
│                                     │     │  └────────────┬────────────────┘ │
│  SQLite DB (existing)               │     │               │                  │
│    terminal_sessions (read)    ←────────────── Scrollback flush (write)      │
│                                     │     │                                  │
└─────────────────────────────────────┘     └──────────────────────────────────┘
```

### Core principle

The daemon is spawned using `ELECTRON_RUN_AS_NODE=1` with `process.execPath` (the Electron binary) so that `node-pty` native addons resolve correctly without any extra bundling. It is spawned with `detached: true` + `unref()` so it becomes fully independent of the Electron process.

### Socket and file locations

| File | Path |
|---|---|
| Unix socket | `~/.branchflux/daemon.sock` |
| PID file | `~/.branchflux/daemon.pid` |
| SQLite DB | Existing app DB path, passed as `BRANCHFLUX_DB_PATH` env var |

## Protocol

Communication uses newline-delimited JSON (NDJSON) over the Unix socket. Terminal output (`data`) is base64-encoded for binary safety.

### Client → Daemon

```typescript
type ClientMessage =
  | { type: "create"; id: string; cwd?: string }
  | { type: "attach"; id: string }      // reconnect to existing PTY after restore
  | { type: "detach"; id: string }      // keep PTY alive, stop streaming to this client
  | { type: "detach-all" }              // app quit/crash path — keep all PTYs alive
  | { type: "write"; id: string; data: string }
  | { type: "resize"; id: string; cols: number; rows: number }
  | { type: "dispose"; id: string }     // user closed tab — kills PTY immediately
  | { type: "list" }                    // request session inventory
```

### Daemon → Client

```typescript
type DaemonMessage =
  | { type: "ready" }
  | { type: "sessions"; sessions: Array<{ id: string; cwd: string; pid: number }> }
  | { type: "data"; id: string; data: string }   // base64 PTY output
  | { type: "exit"; id: string; code: number }
  | { type: "error"; id: string; message: string }
```

### Startup handshake

```
App                              Daemon
 |── connect to socket ────────→ |
 |                          ←── { type: "ready" }
 |── { type: "list" } ────────→ |
 |                          ←── { type: "sessions", sessions: [...] }
 |── { type: "attach", id } ──→ |  (for each surviving session)
 |                          ←── { type: "data", ... }  (buffered output replay)
 |                          ←── { type: "data", ... }  (live output continues)
```

## Session Lifecycle

| Event | What happens |
|---|---|
| App starts | DaemonClient tries to connect; if no socket → spawns daemon, waits for `ready` |
| New terminal tab | `terminal:create` IPC → DaemonClient → `create` → daemon spawns PTY |
| User closes tab | `terminal:dispose` IPC → DaemonClient → `dispose` → daemon kills PTY |
| App quits normally | DaemonClient sends `detach-all`; daemon keeps PTYs alive, flushes scrollback to SQLite |
| App crashes | Daemon detects socket close, treats it as `detach-all`, flushes scrollback |
| App reopens | Connect to daemon, `list` active sessions, replay scrollback from SQLite, `attach` to live PTYs |
| Shell exits naturally | Daemon broadcasts `exit` to all attached clients, removes PTY, flushes final scrollback |

## Scrollback Strategy

- Daemon maintains an in-memory ring buffer (200 rows) per terminal — same limit as current xterm.js serialize
- Flushes to the **existing** `terminal_sessions.scrollback` SQLite column:
  - Every 30 seconds
  - On `detach` / `detach-all`
  - On client socket disconnect (crash path)
  - When a terminal exits
- On reconnect: Electron reads scrollback from SQLite and replays it in xterm.js (unchanged from current flow), then sends `attach` to the daemon for live output

## File Structure

### New files

```
apps/desktop/src/daemon/
├── index.ts            — entry point: starts socket server, handles signals, manages PID file
├── socket-server.ts    — Unix socket server, message routing, multi-client support
├── pty-manager.ts      — owns node-pty instances, in-memory scrollback ring buffer
└── scrollback-store.ts — flushes ring buffer to SQLite (reuses existing schema)

apps/desktop/src/shared/
└── daemon-protocol.ts  — ClientMessage / DaemonMessage types (shared)

apps/desktop/src/main/terminal/
└── daemon-client.ts    — replaces manager.ts: connects to daemon, proxies IPC
```

### Modified files

| File | Change |
|---|---|
| `src/main/terminal/ipc.ts` | Replace `terminalManager.*` with `daemonClient.*` |
| `src/main/index.ts` | Call `daemonClient.connect()` on startup; send `detach-all` instead of `terminalManager.disposeAll()` on quit |
| `src/main/terminal/manager.ts` | Deleted — replaced by `daemon-client.ts` |
| `electron.vite.config.ts` | Add daemon as a fourth build entry → `out/daemon/index.cjs` |
| `src/renderer/App.tsx` | After `hydrate()`, `attach` to sessions present in daemon's live list instead of always creating fresh PTYs |
| `src/main/trpc/routers/terminal-sessions.ts` | `restore` response optionally includes live session IDs from daemon |

### Unchanged files

- `src/renderer/components/Terminal.tsx`
- `src/preload/index.ts`
- `src/main/db/schema.ts`
- `src/main/db/session-persistence.ts`
- `src/renderer/stores/tab-store.ts`
- All other tRPC routers

## Error Handling & Edge Cases

### Daemon crash while app is running
- DaemonClient detects `close`/`error` on socket
- App attempts to respawn daemon using same connect-or-spawn logic
- In-memory scrollback since last flush is lost; SQLite scrollback (last 30s) is preserved
- Once reconnected, terminals with dead PTYs show as disconnected; app creates fresh PTYs and replays SQLite scrollback

### App crash (no `detach-all` sent)
- Daemon detects socket `close` event
- Daemon treats unclean disconnect as `detach-all` — keeps all PTYs alive
- Daemon flushes scrollback to SQLite immediately on disconnect
- On next app start: connects to daemon, gets live sessions, reattaches

### Terminal ID conflict on reconnect
- App sends `create` for an ID already in daemon → daemon returns `error: "already exists"`
- App catches this error and sends `attach` instead — transparent to user

### Stale socket / crashed daemon
- `connect()` returns `ECONNREFUSED` → read PID file → `kill(pid, 0)` → `ESRCH` (process gone)
- Clean up stale `.sock` and `.pid` files, spawn fresh daemon
- SQLite scrollback from previous daemon is intact

### Daemon spawn timeout
- App polls socket for readiness for up to 5 seconds after spawning
- If daemon never becomes ready, app shows an error in affected terminal tabs and continues reconnection attempts
- Terminals are unavailable until the daemon connects; they do not fall back to in-process mode

### Multiple Electron instances
- Both connect to the same daemon socket
- Daemon supports N clients per terminal; all receive `data` events
- Only the client that sent `create` should be permitted to `dispose` that terminal

### System reboot
- Daemon is not a launchd agent; does not survive reboot
- On next app start: no socket → spawn fresh daemon → replay SQLite scrollback → create fresh PTYs
- Identical UX to current restore flow; only non-reboot quits benefit from live PTY continuity

## Build Configuration

Add a fourth entry to `electron.vite.config.ts`:

```typescript
// Daemon — runs as a detached Node.js process via ELECTRON_RUN_AS_NODE=1
{
  entry: "src/daemon/index.ts",
  outDir: "out/daemon",
  rollupOptions: {
    external: ["node-pty", "better-sqlite3"]
  }
}
```

The daemon is invoked from main process as:

```typescript
spawn(process.execPath, [daemonScriptPath], {
  detached: true,
  stdio: "ignore",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", BRANCHFLUX_DB_PATH: dbPath },
})
unref(); // let Electron exit without waiting for daemon
```
