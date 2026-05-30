# Shutdown fsevents-deadlock Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app exit cleanly on quit instead of deadlocking in `fsevents.node` native teardown and requiring a force-quit ("quit unexpectedly").

**Architecture:** Two independent, layered fixes. (1) Close the chokidar/fsevents watchers *deterministically before* Node environment teardown by awaiting `disposeRepoIPC()` under a timeout in `before-quit`. (2) Add a detached out-of-process SIGKILL watchdog that guarantees the process dies even if a native finalizer (fsevents or anything else) wedges the main thread, because the in-process JS `setTimeout` watchdog cannot fire once the event loop is being destroyed. Plus two smaller hardening fixes (daemon SIGTERM on quit, explicit DB close).

**Tech Stack:** Electron 40, TypeScript, Bun (runtime + test runner), chokidar 3.6 / fsevents 2.3.3, better-sqlite3, Biome.

**Root cause (confirmed by macOS spindump `logs.txt`, pid 2445):** On quit the main thread blocks at `node::FreeEnvironment → Environment::CleanupHandles → uv_run → napi finalizer → fse_instance_destroy (fsevents.node) → napi_release_threadsafe_function → uv_mutex_lock → __psynch_mutexwait`, flagged by the kernel turnstile as "part of a deadlock". The watchers are torn down with `void disposeRepoIPC()` (fire-and-forget) at `apps/desktop/src/main/index.ts:441`, so fsevents is still live when env teardown starts. Installed build is v0.9.3 (already has the 3s JS watchdog), and it still hangs — confirming the JS watchdog cannot cover a teardown-phase native deadlock. `main.log` shows `before-quit done +30ms` followed by an ~80s silence then a relaunch, matching the spindump.

---

## File Structure

- `apps/desktop/electron.vite.config.ts:72-75` — add `process-watchdog-entry` as a third `main` rollup input so it is compiled to `out/main/process-watchdog-entry.js`. **This is mandatory**: like `daemon.js`, the watchdog runs as its own process and is NOT bundled into `index.js`; without its own entry it will not exist at runtime and `resolveEntryScript()` will silently find nothing. (Modify)
- `apps/desktop/src/main/index.ts` — `before-quit` and signal handlers; sequence the watcher close + spawn/notify the kill-watchdog + SIGTERM the daemon. (Modify)
- `apps/desktop/src/main/process-watchdog.ts` — NEW. A tiny helper that spawns a detached child process which SIGKILLs our PID after a deadline once quit is requested. (Create)
- `apps/desktop/src/main/process-watchdog-entry.ts` — NEW. The entry script the detached watchdog process runs (reads target PID + delay from argv, waits, SIGKILLs). Must be a self-contained module (no relative imports of other `src/main` files — like `daemon/index.ts`, it is a separate bundle). (Create)
- `apps/desktop/src/main/util/with-timeout.ts` — NEW. Pure `withTimeout` helper with ZERO imports, so its unit test never drags in `electron`/`electron-log`. (Create)
- `apps/desktop/src/main/repo-ipc.ts` — `disposeRepoIPC()` already returns a Promise; add a bounded `disposeRepoIPCWithTimeout()` that uses `withTimeout`. (Modify)
- `apps/desktop/src/main/terminal/daemon-client.ts` — add `killDaemonProcess()` to SIGTERM the detached daemon by PID. (Modify)
- `apps/desktop/src/main/db/index.ts` — expose `closeDb()` that checkpoints + closes the better-sqlite3 handle. (Modify)
- `apps/desktop/tests/process-watchdog.test.ts` — NEW. Unit test for the watchdog arg builder. (Create)
- `apps/desktop/tests/with-timeout.test.ts` — NEW. Unit test that the timeout wrapper resolves even if the inner promise hangs/rejects. (Create)
- `apps/desktop/tests/close-db.test.ts` — NEW. Unit test that `_closeRawDb()` closes the handle and is idempotent. (Create)

**Notes for the implementer (codebase conventions):**
- Package manager + test runner is **Bun**. Tests import from `"bun:test"` (`import { describe, test, expect, beforeEach, afterEach } from "bun:test"`). Run a single file with `bun test apps/desktop/tests/<file>`.
- **Electron in tests:** `bun test` has no Electron runtime. Any `src/main` module that (transitively) does `import ... from "electron"` or `import log from "electron-log/main"` will throw at import time. Existing tests handle this with `mock.module("electron", () => ({ app: { getPath: () => "/tmp/superiorswarm-test" } }))` placed **before** the module import (see `apps/desktop/tests/comment-solver.test.ts`). This plan avoids the problem for pure logic by putting it in import-free modules; the DB test uses the `mock.module` pattern.
- Run all tests from repo root or `apps/desktop/`. The commands below use repo-root-relative paths.
- Indentation is **tabs**, double quotes, semicolons, line width 100 (Biome). Run `bun run check` before committing.
- `isPidAlive(pid)` already exists at `apps/desktop/src/main/terminal/daemon-ownership.ts:50` (uses `process.kill(pid, 0)`); reuse it, do not reimplement.
- The detached terminal daemon writes its PID to a file; `DaemonClient` stores that path as `this.pidPath` (constructor param, `daemon-client.ts:64`).
- electron-log logger is imported as `import { log } from "./logger"` in main files; use `log.info/error`. In the watchdog *entry* script (a bare Node process) do NOT import electron — use `console.error` only.

---

## Task 1: Bounded watcher disposal helper

Make watcher teardown awaitable with a hard timeout so `before-quit` can close fsevents *before* env teardown, but never block longer than the deadline. The timeout logic lives in an import-free util so it is unit-testable without an Electron runtime; `repo-ipc.ts` (which imports `electron`) only adds the thin glue.

**Files:**
- Create: `apps/desktop/src/main/util/with-timeout.ts`
- Modify: `apps/desktop/src/main/repo-ipc.ts:70-74`
- Test: `apps/desktop/tests/with-timeout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/with-timeout.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { withTimeout } from "../src/main/util/with-timeout";

describe("withTimeout", () => {
	test("resolves with the inner value when it finishes before the deadline", async () => {
		const result = await withTimeout(Promise.resolve("done"), 1000, "fallback");
		expect(result).toBe("done");
	});

	test("resolves with the fallback when the inner promise hangs past the deadline", async () => {
		const never = new Promise<string>(() => {});
		const start = Date.now();
		const result = await withTimeout(never, 50, "fallback");
		expect(result).toBe("fallback");
		expect(Date.now() - start).toBeLessThan(500);
	});

	test("does not reject when the inner promise rejects", async () => {
		const rejected = Promise.reject(new Error("boom"));
		const result = await withTimeout(rejected, 1000, "fallback");
		expect(result).toBe("fallback");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/desktop/tests/with-timeout.test.ts`
Expected: FAIL — module `../src/main/util/with-timeout` does not exist.

- [ ] **Step 3: Create the pure util**

Create `apps/desktop/src/main/util/with-timeout.ts` (NO imports — keep it dependency-free):

```typescript
/**
 * Resolves with the inner promise's value, or with `fallback` if it does not
 * settle within `ms`. Never rejects — a rejected inner promise yields `fallback`.
 * Used at quit so a wedged fsevents/chokidar `close()` cannot stall shutdown.
 */
export function withTimeout<T>(inner: Promise<T>, ms: number, fallback: T): Promise<T> {
	return new Promise<T>((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolve(fallback);
		}, ms);
		inner.then(
			(value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(fallback);
			}
		);
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/desktop/tests/with-timeout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `disposeRepoIPCWithTimeout` glue to `repo-ipc.ts`**

In `apps/desktop/src/main/repo-ipc.ts`, add the import near the top (after the existing imports, e.g. after line 5):

```typescript
import { withTimeout } from "./util/with-timeout";
```

Then, immediately after the existing `disposeRepoIPC` function (`apps/desktop/src/main/repo-ipc.ts:70-74`), add:

```typescript
/**
 * Best-effort watcher teardown bounded to `ms`. Returns true if disposal
 * completed, false if it timed out (caller proceeds to exit regardless).
 */
export async function disposeRepoIPCWithTimeout(ms: number): Promise<boolean> {
	const completed = Symbol("completed");
	const result = await withTimeout<typeof completed | "timeout">(
		disposeRepoIPC().then(() => completed),
		ms,
		"timeout"
	);
	return result === completed;
}
```

- [ ] **Step 6: Type-check + commit**

Run: `bun run type-check`
Expected: PASS.

```bash
git add apps/desktop/src/main/util/with-timeout.ts apps/desktop/src/main/repo-ipc.ts apps/desktop/tests/with-timeout.test.ts
git commit -m "feat(quit): bounded repo-watcher disposal helper"
```

---

## Task 2: Out-of-process kill watchdog entry script

A bare Node script that, given a target PID and a delay, waits then SIGKILLs the PID. It runs in its own detached process, so it survives even when our main thread is wedged in native teardown. Like the terminal daemon, it must be its own build entry so it lands at `out/main/process-watchdog-entry.js`.

**Files:**
- Create: `apps/desktop/src/main/process-watchdog-entry.ts`
- Modify: `apps/desktop/electron.vite.config.ts:72-75`
- Test: covered indirectly by Task 3's test (the spawner) and manually in Task 6.

- [ ] **Step 1: Register the build entry**

In `apps/desktop/electron.vite.config.ts`, the `main` rollup input (`:72-75`) currently is:

```typescript
				input: {
					index: resolve(__dirname, "src/main/index.ts"),
					daemon: resolve(__dirname, "src/daemon/index.ts"),
				},
```

Replace it with:

```typescript
				input: {
					index: resolve(__dirname, "src/main/index.ts"),
					daemon: resolve(__dirname, "src/daemon/index.ts"),
					"process-watchdog-entry": resolve(
						__dirname,
						"src/main/process-watchdog-entry.ts"
					),
				},
```

This makes electron-vite emit `out/main/process-watchdog-entry.js` (default `entryFileNames` is `[name].js`), matching the path `resolveEntryScript()` looks for in Task 3.

- [ ] **Step 2: Create the entry script**

Create `apps/desktop/src/main/process-watchdog-entry.ts`:

```typescript
// Standalone watchdog process. NO electron imports — this runs as a bare Node
// process (ELECTRON_RUN_AS_NODE=1). It waits `delayMs` then SIGKILLs `targetPid`,
// unless the parent dies first (in which case waiting is harmless and it exits).
//
// argv: [node, thisScript, <targetPid>, <delayMs>]
const targetPid = Number(process.argv[2]);
const delayMs = Number(process.argv[3]);

if (!Number.isInteger(targetPid) || targetPid <= 0 || !Number.isFinite(delayMs)) {
	console.error("[watchdog] bad args", process.argv.slice(2));
	process.exit(1);
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

setTimeout(() => {
	if (isAlive(targetPid)) {
		console.error(`[watchdog] target ${targetPid} still alive after ${delayMs}ms — SIGKILL`);
		try {
			process.kill(targetPid, "SIGKILL");
		} catch (err) {
			console.error("[watchdog] SIGKILL failed", err);
		}
	}
	process.exit(0);
}, delayMs);
```

- [ ] **Step 3: Verify it builds and emits the entry**

Run: `bun run type-check && bun run build`
Expected: PASS. Then confirm the artifact exists:
Run: `ls apps/desktop/out/main/process-watchdog-entry.js`
Expected: the file is listed (proves the rollup input is wired correctly).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/process-watchdog-entry.ts apps/desktop/electron.vite.config.ts
git commit -m "feat(quit): standalone process kill-watchdog entry script + build entry"
```

---

## Task 3: Watchdog spawner

Spawns the Task 2 script as a detached, unref'd process when a quit begins. Resolving the entry script's built path mirrors how the daemon script path is resolved (compiled output lives under `out/main/`).

**Files:**
- Create: `apps/desktop/src/main/process-watchdog.ts`
- Test: `apps/desktop/tests/process-watchdog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/process-watchdog.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { buildWatchdogArgs } from "../src/main/process-watchdog";

describe("buildWatchdogArgs", () => {
	test("passes the entry script, target pid, and delay as strings", () => {
		const args = buildWatchdogArgs("/x/out/main/process-watchdog-entry.js", 4242, 5000);
		expect(args).toEqual(["/x/out/main/process-watchdog-entry.js", "4242", "5000"]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/desktop/tests/process-watchdog.test.ts`
Expected: FAIL — `buildWatchdogArgs` not exported.

- [ ] **Step 3: Create the spawner**

Create `apps/desktop/src/main/process-watchdog.ts`. `electron` and `./logger` are
`require`d **lazily inside** `armKillWatchdog` (not top-level imports) so that
`buildWatchdogArgs` can be imported in a `bun test` without pulling in the Electron
runtime. Only node builtins are imported at module top level.

```typescript
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

let spawned = false;

/** Pure arg builder, unit-testable without spawning or importing electron. */
export function buildWatchdogArgs(entryScript: string, targetPid: number, delayMs: number): string[] {
	return [entryScript, String(targetPid), String(delayMs)];
}

/**
 * Spawn a detached process that SIGKILLs us after `delayMs`. Safe to call once;
 * repeated calls are ignored. This is the only guard that survives a frozen main
 * thread (e.g. the fsevents teardown deadlock), because an in-process JS timer
 * cannot fire once Node's environment is being destroyed.
 */
export function armKillWatchdog(delayMs = 5000): void {
	if (spawned) return;
	spawned = true;
	// Lazy require: keeps the module import-clean for unit tests.
	const { app } = require("electron") as typeof import("electron");
	const { log } = require("./logger") as typeof import("./logger");
	const entryScript = join(app.getAppPath(), "out", "main", "process-watchdog-entry.js");
	if (!existsSync(entryScript)) {
		log.error("[quit] kill-watchdog entry script not found — skipping");
		return;
	}
	try {
		const child = spawn(process.execPath, buildWatchdogArgs(entryScript, process.pid, delayMs), {
			detached: true,
			stdio: "ignore",
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
		});
		child.unref();
		log.info(`[quit] kill-watchdog armed (pid ${process.pid}, +${delayMs}ms)`);
	} catch (err) {
		log.error("[quit] failed to arm kill-watchdog", err);
	}
}
```

Note: `require(...)` in a TypeScript ESM file is valid in this codebase's main
process (CommonJS output target). If Biome's lint flags the bare `require`, the
`as typeof import(...)` cast keeps it fully typed; `bun run check` will pass.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/desktop/tests/process-watchdog.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/process-watchdog.ts apps/desktop/tests/process-watchdog.test.ts
git commit -m "feat(quit): detached kill-watchdog spawner"
```

---

## Task 4: Explicit DB close

Checkpoint and close the better-sqlite3 handle at quit so the WAL is finalized and no native sqlite handle lingers into teardown.

**Files:**
- Modify: `apps/desktop/src/main/db/index.ts:11,18-34`
- Test: `apps/desktop/tests/close-db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/close-db.test.ts`. `../src/main/db` does
`import { app } from "electron"` at module load, so mock electron BEFORE importing
it (same pattern as `tests/comment-solver.test.ts`):

```typescript
import { describe, expect, mock, test } from "bun:test";
import Database from "better-sqlite3";

mock.module("electron", () => ({
	app: { getPath: () => "/tmp/superiorswarm-test" },
}));

import { _closeRawDb } from "../src/main/db";

describe("_closeRawDb", () => {
	test("checkpoints and closes an open handle, and is idempotent", () => {
		const db = new Database(":memory:");
		db.pragma("journal_mode = WAL");
		expect(db.open).toBe(true);
		_closeRawDb(db);
		expect(db.open).toBe(false);
		// second call must not throw
		_closeRawDb(db);
		expect(db.open).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/desktop/tests/close-db.test.ts`
Expected: FAIL — `_closeRawDb` not exported.

- [ ] **Step 3: Add the raw-close helper and `closeDb()`**

In `apps/desktop/src/main/db/index.ts`, add a module-level reference to the raw handle and the close functions. Change the handle storage (around `:11` and `:27-33`):

```typescript
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _rawSqlite: Database.Database | null = null;
```

In `getDb()`, capture the raw handle right after creating it (after `:30`, before `_db = drizzle(...)`):

```typescript
	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("foreign_keys = ON");

	_rawSqlite = sqlite;
	_db = drizzle(sqlite, { schema });
	return _db;
```

Add at the end of the file:

```typescript
/** Internal: checkpoint + close a raw handle. Idempotent. Exported for tests. */
export function _closeRawDb(sqlite: Database.Database): void {
	try {
		if (!sqlite.open) return;
		try {
			sqlite.pragma("wal_checkpoint(TRUNCATE)");
		} catch {
			// checkpoint is best-effort
		}
		sqlite.close();
	} catch {
		// already closed / closing — ignore
	}
}

/** Close the app database at quit. Safe to call when never opened. */
export function closeDb(): void {
	if (_rawSqlite) {
		_closeRawDb(_rawSqlite);
		_rawSqlite = null;
	}
	_db = null;
}
```

Ensure `Database` is imported as a value (it already is: `import Database from "better-sqlite3"` at `db/index.ts:3`). The type `Database.Database` is available from that default import.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/desktop/tests/close-db.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/db/index.ts apps/desktop/tests/close-db.test.ts
git commit -m "feat(quit): explicit WAL checkpoint + DB close helper"
```

---

## Task 5: Daemon SIGTERM on quit

Actively terminate the detached terminal daemon instead of relying on its 5-minute idle timeout, so it stops holding the shared WAL DB after we quit.

**Files:**
- Modify: `apps/desktop/src/main/terminal/daemon-client.ts` (add method near `disconnect()`, `:125-136`)

- [ ] **Step 1: Add `killDaemonProcess()` to `DaemonClient`**

In `apps/desktop/src/main/terminal/daemon-client.ts`, add this method directly after `disconnect()` (ends at `:136`). `readFileSync`/`existsSync` are already imported (`:1-11`); `isPidAlive` is already imported (`:22`).

```typescript
	/**
	 * Best-effort: SIGTERM the detached daemon by its PID file so it releases the
	 * shared WAL DB + socket promptly instead of waiting out its idle timeout.
	 * The daemon handles SIGTERM cleanly (src/daemon/index.ts). Never throws.
	 */
	killDaemonProcess(): void {
		try {
			if (!existsSync(this.pidPath)) return;
			const pid = Number(readFileSync(this.pidPath, "utf-8").trim());
			if (!pid || !isPidAlive(pid)) return;
			process.kill(pid, "SIGTERM");
		} catch {
			// best effort — daemon may already be gone
		}
	}
```

- [ ] **Step 2: Type-check**

Run: `bun run type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/terminal/daemon-client.ts
git commit -m "feat(quit): SIGTERM the terminal daemon on quit"
```

---

## Task 6: Wire everything into `before-quit` and signal handlers

Sequence the quit path: arm the out-of-process kill watchdog first (guarantees exit), then do best-effort ordered cleanup (close watchers with timeout → kill daemon → disconnect → close DB → other teardown).

**Files:**
- Modify: `apps/desktop/src/main/index.ts:40` (imports), `:416-455` (before-quit), `:469-481` (signal handlers)

- [ ] **Step 1: Add imports**

At `apps/desktop/src/main/index.ts:40`, the line currently is:

```typescript
import { disposeRepoIPC, setupRepoIPC } from "./repo-ipc";
```

Replace it with:

```typescript
import { disposeRepoIPCWithTimeout, setupRepoIPC } from "./repo-ipc";
```

Add the watchdog import near the other local imports (e.g. after the `./repo-ipc` line):

```typescript
import { armKillWatchdog } from "./process-watchdog";
```

And add `closeDb` to the EXISTING `./db` import. That line (`apps/desktop/src/main/index.ts:27`) currently is:

```typescript
import { backfillRemoteHosts, getDb, initializeDatabase } from "./db";
```

Change it to:

```typescript
import { backfillRemoteHosts, closeDb, getDb, initializeDatabase } from "./db";
```

(`bun run check` will reorder/organize imports if needed.)

- [ ] **Step 2: Replace the `before-quit` handler**

Replace the whole `app.on("before-quit", ...)` block (`apps/desktop/src/main/index.ts:416-455`) with:

```typescript
app.on("before-quit", () => {
	const t0 = Date.now();
	log.info("[quit] before-quit start");

	// 1) Out-of-process kill-watchdog FIRST. An in-process JS setTimeout cannot
	// fire once Node tears down its environment (fsevents finalizer deadlock), so
	// this detached process guarantees we die even if the main thread wedges.
	armKillWatchdog(5000);

	try {
		deleteControlDiscovery(app.getPath("userData"));
	} catch {}
	log.debug(`[quit] discovery-deleted +${Date.now() - t0}ms`);

	alertListener?.stop();
	setAgentNotifyPort(null);
	stopCommentPoller();
	teardownUpdater();
	log.debug(`[quit] timers-stopped +${Date.now() - t0}ms`);

	// 2) Close chokidar/fsevents watchers BEFORE env teardown so the fsevents
	// threadsafe-function is gone before Node finalizes it. Bounded so a wedged
	// close() cannot stall us (the kill-watchdog still covers the worst case).
	void disposeRepoIPCWithTimeout(2000).then((ok) => {
		log.info(`[quit] repo watchers disposed=${ok} +${Date.now() - t0}ms`);
	});

	// 3) Stop the detached daemon so it releases the shared WAL DB + socket.
	daemonClient.setQuitting();
	daemonClient.detachAll();
	daemonClient.killDaemonProcess();
	daemonClient.disconnect();
	log.debug(`[quit] daemon-stopped +${Date.now() - t0}ms`);

	serverManager.disposeAll();

	// 4) Finalize + close our DB handle.
	try {
		closeDb();
	} catch (err) {
		log.error("[quit] closeDb failed", err);
	}
	log.debug(`[quit] db-closed +${Date.now() - t0}ms`);

	if (controlPlane) {
		void controlPlane.stop().catch((err) => {
			log.error("[control-plane] stop failed:", err);
		});
		controlPlane = null;
		setEventBus(null);
		if (detachOrchestratorSink) {
			detachOrchestratorSink();
			detachOrchestratorSink = null;
		}
	}
	log.info(`[quit] before-quit done +${Date.now() - t0}ms`);
});
```

- [ ] **Step 3: Update the signal handlers**

Replace the signal-handler loop (`apps/desktop/src/main/index.ts:469-481`) with:

```typescript
for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
	process.on(signal, () => {
		armKillWatchdog(5000);
		alertListener?.stop();
		setAgentNotifyPort(null);
		teardownUpdater();
		daemonClient.setQuitting();
		daemonClient.detachAll();
		daemonClient.killDaemonProcess();
		daemonClient.disconnect();
		void disposeRepoIPCWithTimeout(2000);
		serverManager.disposeAll();
		try {
			closeDb();
		} catch {}
		app.exit(0);
	});
}
```

- [ ] **Step 4: Type-check + lint**

Run: `bun run type-check && bun run check`
Expected: PASS, no type or lint errors. (`disposeRepoIPC` is no longer imported in index.ts — confirm no other references remain there.)

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: PASS (existing tests + the 3 new ones). If any pre-existing test referenced `disposeRepoIPC` from index, none should — it is still exported from `repo-ipc.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "fix(quit): arm kill-watchdog + ordered teardown to stop fsevents deadlock"
```

---

## Task 7: Manual verification on a real build

The deadlock only reproduces in a packaged/run app with live repo watchers, so this must be verified by running the app, not just unit tests.

**Files:** none (verification only).

- [ ] **Step 1: Build + launch the app**

Run: `bun run build` then launch the app (or `bun run dev`). Open a project so a repo watcher is active (the bug needs a live chokidar/fsevents watcher).

- [ ] **Step 2: Capture a clean-quit spindump baseline**

In a terminal, with the app running and a project open, prepare to quit and immediately sample:

Run: `osascript -e 'quit app "SuperiorSwarm"'` then within ~2s `spindump SuperiorSwarm 5 -file /tmp/quit-after.txt` (or use Activity Monitor → Sample Process if it beachballs).

- [ ] **Step 3: Confirm the deadlock frame is gone**

Run: `grep -c "fse_instance_destroy\|napi_release_threadsafe_function" /tmp/quit-after.txt`
Expected: `0` on CrBrowserMain (the frame should no longer hold the main thread). The app process should exit on its own within the watchdog window.

- [ ] **Step 4: Confirm exit without force-quit**

Quit the app normally several times. Expected: window closes and the process exits within ~2s every time; no spinning beachball, no "quit unexpectedly" dialog on relaunch. Check `~/Library/Logs/SuperiorSwarm/main.log` shows `[quit] before-quit done` followed promptly by a clean next-launch `App started` (no ~80s gap like the original incident at 15:15:11 → 15:16:31).

- [ ] **Step 5: Confirm the daemon is gone after quit**

Run: `pgrep -lf "daemon.js" | grep -i superior || echo "no daemon running"`
Expected: `no daemon running` shortly after quit (Task 5 SIGTERM). Also confirm only one daemon spawns per launch.

- [ ] **Step 6: Update the analysis doc status**

Edit `SHUTDOWN_ANALYSIS.md` to mark the root cause fixed and link this plan. Commit:

```bash
git add SHUTDOWN_ANALYSIS.md
git commit -m "docs: mark shutdown fsevents deadlock fixed"
```

---

## Self-Review notes

- **Spec coverage:** P0 fsevents fix = Tasks 1+2+3+6 (bounded watcher close before teardown + out-of-process SIGKILL guard, with the build-entry wiring inside Task 2). P1 daemon = Task 5+6. P2 DB close = Task 4+6. Manual proof = Task 7. All items in `SHUTDOWN_ANALYSIS.md` "FIX PLAN" are covered except the optional "migrate to chokidar v4 / disable fsevents backend", deliberately deferred — Tasks 1+3 should resolve the hang without a dependency bump; if Task 7 still shows the frame, the fallback is a follow-up (see below).
- **Type consistency:** `withTimeout<T>(inner, ms, fallback): Promise<T>` (util, Task 1), `disposeRepoIPCWithTimeout(ms): Promise<boolean>` (repo-ipc, Task 1), `armKillWatchdog(delayMs): void` + `buildWatchdogArgs(entry, pid, delay): string[]` (Task 3), `killDaemonProcess(): void` (Task 5), `closeDb(): void` + `_closeRawDb(sqlite): void` (Task 4) — every symbol consumed in Task 6 is defined in an earlier task with the same name and signature.
- **Build/runtime gotcha (verified against `electron.vite.config.ts:72-75`):** the watchdog entry is a *separate rollup input*, not bundled into `index.js` — exactly like `daemon.js`. Task 2 adds the input AND verifies `out/main/process-watchdog-entry.js` exists after `bun run build`. Without this the watchdog silently never arms.
- **Test/Electron gotcha (verified against `tests/comment-solver.test.ts`, `logger.ts`):** `bun test` has no Electron. Pure logic (`withTimeout`, `buildWatchdogArgs`) is isolated into import-clean modules / lazy `require`s so its tests load no Electron; the DB test uses `mock.module("electron", ...)` before import. This is why Task 1 splits out `util/with-timeout.ts` and Task 3 uses lazy requires.
- **Fallback if Task 7 still reproduces:** add a follow-up task to switch `repo-watcher.ts` watchers to chokidar v4 or `{ useFsEvents: false }` (polling/`fs.watch`), which removes the `fse_instance_destroy` finalizer entirely. The kill-watchdog (Task 3) already guarantees the app dies regardless, so the symptom is mitigated even before that follow-up.
- **Why arm the watchdog before cleanup:** if any cleanup step itself wedges, the detached process still SIGKILLs us at the deadline. SIGKILL skips Node's `Environment::CleanupHandles`, so the fsevents finalizer never runs.
- **Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to Task N" — every code step has complete code.
