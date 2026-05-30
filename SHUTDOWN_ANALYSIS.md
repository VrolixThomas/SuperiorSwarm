# Shutdown hang + force-quit crash — root cause & fix plan

> **STATUS (2026-05-30): FIXED in branch `applicationshutdown`.** Root cause = fsevents (chokidar) N-API threadsafe-function deadlock during Node environment teardown on quit. Fix implemented in 6 commits per `docs/superpowers/plans/2026-05-30-shutdown-fsevents-deadlock-fix.md`:
> 1. bounded watcher disposal (`util/with-timeout.ts`, `disposeRepoIPCWithTimeout`)
> 2. out-of-process SIGKILL watchdog (`process-watchdog-entry.ts` + build entry, `process-watchdog.ts`/`armKillWatchdog`) - the guard that survives a frozen main thread
> 3. explicit WAL checkpoint + DB close (`closeDb`)
> 4. active daemon SIGTERM on quit (`killDaemonProcess`)
> 5. ordered teardown wired into `before-quit` + signal handlers (`index.ts`)
> Verified: type-check passes, unit tests pass (with-timeout, process-watchdog, close-db), production build emits `out/main/process-watchdog-entry.js`. REMAINING: Task 7 manual verification on a packaged build (launch app with a project open, quit, confirm clean exit + no "quit unexpectedly", re-capture spindump to confirm `fse_instance_destroy` no longer holds CrBrowserMain).


Status: **ROOT CAUSE CONFIRMED from a macOS spindump of the live process.** The
chain was hard to see and two earlier guesses were wrong — both retracted below so
nobody re-walks them. The decisive evidence is the fully-symbolized main-thread
stack in the spindump (`logs.txt`).

## Symptoms
- Quitting lags / beachballs and never finishes.
- Force-quitting shows the macOS "quit unexpectedly" error.

## ROOT CAUSE (confirmed)
On quit, the Electron **main thread deadlocks inside `fsevents.node`'s native
teardown during Node's environment cleanup**. The process can no longer exit on its
own; only SIGKILL (force quit) ends it, and SIGKILL of a process mid-native-teardown
is what produces "quit unexpectedly".

Exact main-thread stack (spindump `logs.txt`, `SuperiorSwarm [2445]`, thread
`CrBrowserMain`, `last ran 53.466s ago`, flagged `part of a deadlock`):
```
start → ElectronMain → … → node::FreeEnvironment
  → node::Environment::RunCleanup → node::Environment::CleanupHandles
    → uv_run
      → node::ThreadPoolWork::ScheduleWork lambda  (napi finalizer dispatch)
        → node_napi_env__::DeleteMe → v8impl::Reference::Finalize
          → CallFinalizer
            → fse_instance_destroy  (fsevents.node + 3048)
              → napi_release_threadsafe_function
                → uv_mutex_lock → _pthread_mutex_firstfit_lock_slow
                  → __psynch_mutexwait → psynch_mtxcontinue
                     *  (blocked by turnstile — part of a deadlock)
```
This is a Node/N-API **threadsafe-function teardown deadlock in fsevents**: during
`Environment::CleanupHandles`, Node finalizes the fsevents JS reference, which calls
`napi_release_threadsafe_function`, which blocks forever on a mutex already held in
the same teardown turnstile. The main thread is wedged; the event loop is gone, so
no JS can run.

**What the dump does and does not show (kept precise on purpose):**
- The main thread's blocking site is unambiguous and is the heaviest stack:
  `…CallFinalizer → fse_instance_destroy → napi_release_threadsafe_function →
  uv_mutex_lock → _pthread_mutex_firstfit_lock_slow → __psynch_mutexwait`, and
  spindump annotates the leaf `psynch_mtxcontinue` as
  *"blocked by turnstile waiting for this thread - part of a deadlock"*. So macOS's
  own turnstile bookkeeping classifies this as a real deadlock, with the contended
  resource being the fsevents threadsafe-function's `uv_mutex`.
- The counter-party thread that holds that mutex is **not separately symbolized** in
  this dump (the other native threads, e.g. `0x23690`, sample as bare
  `_pthread_start → thread_start` with no fsevents/napi frames; there is no
  `fsevents_callback` / `napi_call_threadsafe_function` frame anywhere). So the exact
  holder is not proven from this capture — do not claim a specific second stack.
- Mechanism (consistent with the evidence, and the known fsevents-on-exit hang):
  finalizing/releasing the fsevents threadsafe function during env teardown blocks
  on a mutex that the fsevents native CFRunLoop/callback side still holds. It can
  only arise if the watcher is still live when teardown begins — i.e. it was not
  closed and awaited before exit (which matches the `void disposeRepoIPC()`
  fire-and-forget at `index.ts:441`).
- Note: there is also an idle `notify-rs fsevents loop` thread (`0x23d63`) — a
  second FSEvents consumer in the process — but it is idle and not the blocking site.

### Why every symptom follows
- **Lag/beachball on quit:** main thread frozen in native teardown → UI dead.
- **3s JS watchdog does not save it:** the watchdog is `setTimeout(app.exit, 3000)`
  on the JS event loop. By the time we're in `node::FreeEnvironment` the event loop
  is being destroyed — a JS timer cannot fire here. Worse, calling `app.exit()`
  *itself* enters this same teardown and hits the same fsevents deadlock, so the
  watchdog is useless against this specific failure.
- **Force-quit "quit unexpectedly":** the only escape is SIGKILL, delivered while
  native fsevents/pty/sqlite handles are live → crash-style termination dialog.

## Confirmed facts
- Installed app is **v0.9.3** (`/Applications/SuperiorSwarm.app`,
  `CFBundleShortVersionString = 0.9.3`; `app.asar` contains the watchdog string), so
  this is current code WITH the watchdog and graceful teardown — and it still hangs.
- Dependency: **chokidar @3.6.0** with optional **fsevents @2.3.3**; the native
  `fsevents.node` ships in
  `app.asar.unpacked/node_modules/fsevents/fsevents.node`.
- Only user of chokidar is `apps/desktop/src/main/git/repo-watcher.ts:2`
  (`import { watch } from "chokidar"`), watching each repo's `.git` dir and worktree
  with `{ persistent: true, ignoreInitial: true, depth: 8 }`. On macOS chokidar uses
  the FSEvents backend → that is the `fsevents.node` instance deadlocking on teardown.
- Watcher cleanup is **fire-and-forget at quit**: `before-quit` calls
  `void disposeRepoIPC()` (`index.ts:441`) without awaiting. `disposeRepoIPC` →
  `RepoWatcherManager.disposeAll()` → `RepoWatcher.close()` →
  `Promise.all([gitDirWatcher.close(), worktreeWatcher.close()])`
  (`git/repo-watcher.ts:80-88`). Because it is not awaited, Electron proceeds to
  environment teardown while fsevents instances may still be live / mid-close →
  the finalizer-time `napi_release_threadsafe_function` deadlock.

## Retracted earlier guesses (do not re-investigate)
1. "Un-awaited async cleanup in `before-quit` hangs quit." Wrong — no
   `event.preventDefault()`, nothing awaited; fire-and-forget cannot block quit.
2. "Main thread self-deadlocks inside synchronous SQLite (`node:sqlite` UDF)."
   Wrong — those `node::sqlite::… +118128` / `…xDestroy +33056` names had huge
   symbol offsets (nearest-export mis-symbolication) and were not on the main
   thread. The real leaf is `fsevents.node` (see stack above). The DB is
   better-sqlite3, not node:sqlite; sqlite activity in the dump is on other procs
   (e.g. `analyticsd`), not the hang.

## FIX PLAN

### P0 — Stop the fsevents teardown deadlock (the actual fix)
Option A (most robust, recommended): **never let Node run fsevents' finalizer at
exit — hard-exit instead.** After best-effort synchronous cleanup, terminate the
process in a way that skips JS/N-API environment teardown:
- spawn a **detached out-of-process watchdog** at startup that `SIGKILL`s our PID a
  short time after a quit is requested (heartbeat-based). SIGKILL bypasses
  `Environment::CleanupHandles` entirely, so the fsevents finalizer never runs. This
  also fixes the "JS watchdog can't fire on a dead loop" weakness for all future
  teardown hangs, not just this one.

Option B (address the watcher directly): **deterministically close fsevents
watchers before teardown.**
- In `before-quit`, `await disposeRepoIPC()` under a short `Promise.race` timeout
  (e.g. 1s) instead of `void`-ing it, so watchers are closed *before* env teardown.
- If closing still deadlocks, **migrate off the fsevents backend**: upgrade to
  chokidar v4 (no bundled-fsevents finalizer path) or set chokidar
  `useFsEvents:false` (polling/`fs.watch`) for these watchers. This removes the
  `fse_instance_destroy` finalizer that deadlocks.

Best results come from A + B together: close watchers cleanly when possible, and a
SIGKILL backstop so a wedged native finalizer can never hold the app open.

### P1 — Make the daemon stop with the app (independent hardening)
- Daemon is spawned `detached:true`+`unref()` and never killed by main
  (`daemon-client.ts:469-484`); it self-exits only after a 5-min idle timeout with
  no owner-liveness check (`daemon/index.ts:42-79`). On quit, actively `SIGTERM` it
  (it handles SIGTERM cleanly, `daemon/index.ts:102-104`) and add an owner-liveness
  check so a stale daemon exits promptly and releases the shared WAL lock.

### P2 — Cleanliness (not the freeze, prevents leaks/late native crashes)
- Explicitly `close()` the main DB (after `wal_checkpoint(TRUNCATE)`) in
  `before-quit` (`db/index.ts` never closes it).
- Reconcile/remove the stale node-pty comment at `index.ts:463-468` (the real
  teardown-deadlock culprit is fsevents, not node-pty).

## How to verify the fix
- Reproduce quit + force-quit; confirm the process exits on its own (no SIGKILL
  needed) and no "quit unexpectedly" dialog.
- Re-capture a spindump during quit (`spindump SuperiorSwarm 5 -file /tmp/q.txt`)
  and confirm `fse_instance_destroy` / `napi_release_threadsafe_function` no longer
  appears on `CrBrowserMain`.
- Confirm `~/Library/Logs/SuperiorSwarm/main.log` shows quit completing (and, if
  P1 done, the daemon process gone) after quit.

## Key files / evidence
- Spindump: `logs.txt` (main-thread stack = the proof).
- App log: `~/Library/Logs/SuperiorSwarm/main.log` (older `appfreezing*.log`,
  `appcrashed1751.log` from 2026-04-07 corroborate the same class).
- `apps/desktop/src/main/git/repo-watcher.ts:2,80-88` — chokidar/fsevents watch + close.
- `apps/desktop/src/main/repo-ipc.ts:70-74` → `git/repo-watcher-manager.ts:43-47` — disposeAll.
- `apps/desktop/src/main/index.ts:416-481` — before-quit (`void disposeRepoIPC()` at 441), watchdog, signal handlers.
- `apps/desktop/src/main/db/index.ts:27-32` — main DB (better-sqlite3, WAL), never closed.
- `apps/desktop/src/main/terminal/daemon-client.ts:469-484` — daemon detached+unref, never killed.
- `apps/desktop/src/daemon/index.ts:42-104` — daemon 5-min idle exit, SIGTERM handling, no owner-liveness check.
- Deps: `apps/desktop/package.json:45` chokidar ^3.6.0; `bun.lock` fsevents 2.3.3; Electron ^40.
