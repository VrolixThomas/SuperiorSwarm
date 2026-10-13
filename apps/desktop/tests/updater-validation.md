# macOS updater validation and window lifecycle

The reported installed application identified itself as 0.23.0 and had an ad-hoc,
code-hash-bound designated requirement without a Team Identifier. Its origin is
unknown. This is **not evidence about the signing of the official 0.23.0 release**.
The supplied 0.23.2 candidate passed strict Developer ID verification but did not
satisfy that particular installation's requirement. Extracted applications and
logs are evidence, never source files to modify.

## Locked semantics and implementation

Reviewed `bun.lock` and installed `electron-updater` **6.8.3**:

- `out/MacUpdater.js`, `updateDownloaded`: prepares a loopback feed and emits the
  library `update-downloaded` before native Squirrel download/validation.
- With `autoInstallOnAppQuit=false`, that method resolves without initiating
  native validation. Restart explicitly calls Electron's native `checkForUpdates`
  against the library-prepared feed. All native verification remains enabled.
- The MacUpdater constructor's native `update-downloaded` listener sets
  `squirrelDownloadedUpdate`. Our listener is registered after it. Only then do
  we invoke the library's `quitAndInstall` once. Calling earlier in this version
  adds a persistent native listener with no cancellation API; repeated attempts
  could otherwise queue unexpected quits.
- `out/BaseUpdater.js` on other platforms emits native `before-quit-for-update`
  only after its install method succeeds, then requests app quit.
- Electron **40.8.5** [`electron_api_auto_updater.cc`](https://github.com/electron/electron/blob/v40.8.5/shell/browser/api/electron_api_auto_updater.cc)
  emits `before-quit-for-update` before closing windows. Its
  [`auto_updater_mac.mm`](https://github.com/electron/electron/blob/v40.8.5/shell/browser/auto_updater_mac.mm)
  publishes native download completion after Squirrel's command succeeds, then
  uses `relaunchToInstallUpdate` on quit/install. A relaunch error can arrive
  after windows close, so recovery calls the normal window creation function.

No application code closes a window to initiate an update. The install overlay
is reserved for the authoritative native quit signal. Validation shows a small,
nonblocking toast; the rest of the workspace remains usable. Downloads are
explicitly pending validation. Automatic install on ordinary app quit is disabled;
installation now requires the explicit Restart action on every platform.

The main service owns immutable status snapshots and revisions. Phases distinguish
idle, checking, available, downloading, downloaded, validating, installing,
validation-failed, and error. Recovery distinguishes retry, signed reinstall,
and quit/reopen guidance. Error strings shown in the UI are fixed messages;
full errors stay in the existing main-process logger. Requirement incompatibility
does not diagnose how the installed app was signed. Other signature failures ask
for another verified download; generic check/download/install errors remain distinct.

Service listeners are registered once, detached by identity, and never remove
library listeners. Checks and installs are guarded. Renderer polling continues
while downloaded, validating, or unfocused, and refetches on mount. Revisions
reject stale responses. Startup notifications and dismissal rollbacks cannot
replace newer errors. The macOS activate/window-all-closed handlers retain their
existing behavior.

A 60-second lifecycle timeout (10 minutes between byte-download progress events)
removes the busy UI. Since the native API has no cancellation primitive, timeout
recovery requires quitting/reopening before another attempt; late success does
not invoke our quit/install callback. Native Squirrel may still apply an already
staged update on a later ordinary exit/relaunch. A renderer request watchdog also bounds a lost install
reply, including unmount while waiting. An already committed native installation
cannot be cancelled by the UI; packaged QA must cover native relaunch failures.

## RED → GREEN → REFACTOR record (2026-10-13)

Tests ran before each corresponding production change. No real updater or app was
launched. Commands run from the repository root unless indicated otherwise.

1. `bun test apps/desktop/tests/updater-lifecycle.test.ts`: initial **RED**, two
   intended assertion failures: window visibility was false after Restart, and
   `updateDownloaded` remained true after a delayed native requirement error.
   Minimal window/error fix: **GREEN** (two inner tests).
2. Added lifecycle/duplicate-click/retry/listener tests: **RED**, four new failures
   (native validation not started, missing phases, and increasing listener count).
   Extracted the lifecycle service and routed operations through it: **GREEN**.
3. `bun test apps/desktop/tests/update-store.test.ts`: **RED**, two new status-sync
   failures; implemented revision-aware renderer recovery: **GREEN**.
4. Added rendered About/toast tests over the actual tRPC IPC link: **RED**, pending
   validation text and visible recovery absent. Shared polling/actions: **GREEN**.
5. Independent review found additional cases, each tested RED before its fix:
   Squirrel's “improperly signed” wording; window recovery helper; phase-specific
   generic errors; late dismissal rollback; release notification metadata;
   teardown during async initialization; startup notification precedence; and
   unmount during a lost install reply. Refactoring kept these tests GREEN.

The isolated test runner additionally exercises **actual locked MacUpdater code**
with fake native Electron APIs and inert temporary bytes. It covers the library's
proxy setup, early downloaded event, error forwarding, native-ready flag, retry,
listener count, and exactly one quit signal. It does not contact a release feed,
run native Electron/Squirrel, or claim a real relaunch occurred.

## Safe native requirement harness

```sh
bun apps/desktop/tests/fixtures/updater/signing-boundary.ts
```

Executed successfully on macOS. Generates two disposable Mach-O executables using
clang, ad-hoc signs with `codesign --sign - --timestamp=none`, and verifies each
strictly. An identical-code copy satisfies the first fixture's designated
requirement; the different-code candidate fails with the reported requirement
error. All temporary files are deleted in `finally`. Nothing is executed.

This proves that valid code verification and installed-requirement compatibility
are different checks. It does **not** reproduce Developer ID identity matching,
notarization, Gatekeeper, Squirrel installation, or relaunch. It neither accesses
Keychain/signing identities nor reads or modifies installed apps.

## Packaged release acceptance gate (not executed locally)

Run only in an authorized disposable macOS VM/test account with disposable signed
QA artifacts and its own app data. Never point this procedure at a user's working
installation. Signing is supplied by the existing release pipeline; this test
must not create/use developer credentials locally or weaken verification.

1. Install the baseline QA build containing this fix, signed with the release
   identity and normal designated requirement. Prepare a higher-version QA update
   signed with the compatible identity using the normal package/update pipeline.
   Record versions, Team Identifiers, requirements, strict verification, and
   notarization/Gatekeeper results privately as release evidence.
2. Download through the QA feed. Verify the UI describes downloaded bytes with
   validation pending. Restart repeatedly from About and the toast. While native
   validation is pending, exercise the workspace; it must remain visible/usable.
3. Confirm exactly one native validation/quit/install sequence, followed by
   relaunch into the expected higher version. Confirm saved work and terminal
   reattachment. No pre-validation window close or signature-policy changes.
4. On a separate disposable baseline copy, apply ad-hoc signing **only to that QA
   fixture** to obtain a hash-bound requirement. Offer the otherwise valid signed
   candidate. Confirm native rejection, visible signed-reinstall guidance, no
   Restart-ready state or queued quits, and continued workspace operation. This
   synthetic origin says nothing about the reported user's installation.
5. Exercise unavailable feed, interrupted download, invalid candidate signature,
   and installer permission/disk failure separately. Verify specific recovery,
   safe messages, full private log diagnostics, retries after definitive errors,
   and quit/reopen guidance after an indeterminate timeout.
6. Reload the renderer and close/reopen its window via the Dock during pending
   and failed states. Confirm current status, working controls, stable listener
   counts, and window recreation after a post-closure native install error.
7. Smoke-test packaged Windows/Linux explicit install: one library install/quit,
   no native macOS check, no duplicate attempt, and failure recovery.

A compatible signed end-to-end install/relaunch is a **release QA gate**, not a
claim made by the local mocks, disposable signing harness, or production build.

## Final local verification

- Focused updater/store tests and neighboring settings, IPC safety, single-instance,
  and quit-watchdog tests: **75 passed**, using the command below. The three
  isolated wrappers additionally run **17 service/router/window tests, five
  rendered IPC/UI tests, and one actual locked-library seam test**.
- Neighboring LSP IPC tests: **7 passed**; terminal file IPC tests: **11 passed**.
  Run these in separate processes: their existing global Electron module mocks
  conflict when combined with other suites. A combined attempt exposed that
  mock contamination; the separate runs passed without production changes.
- Biome on all 19 changed TypeScript/TSX files: passed with no remaining changes.
- Changed-path TypeScript diagnostics: **zero new errors**, comparing diagnostics
  with a Compiler API host reading original changed files from `git show HEAD`.
  Full projects still have baseline errors: main 66 (seven on the already-broken
  `index.ts` imports/ImportMeta types), preload zero, renderer 86, tests 208
  (six pre-existing Bun SQLite shim type errors on the changed mock preload).
  These are not represented as a clean full-repository type-check.
- `cd apps/desktop && bun run build`: passed (main, preload, renderer). Existing
  Browserslist age warning remains. Build only; no app execution or packaging.
- Disposable native signing requirement harness: passed.
- `git diff --check`: passed.

```sh
bun test --preload ./apps/desktop/tests/preload-electron-mock.ts \
  apps/desktop/tests/updater.test.ts \
  apps/desktop/tests/update-store.test.ts \
  apps/desktop/tests/updater-lifecycle.test.ts \
  apps/desktop/tests/editor-settings-store.test.ts \
  apps/desktop/tests/ipc-safety.test.ts \
  apps/desktop/tests/single-instance.test.ts \
  apps/desktop/tests/process-watchdog.test.ts
bun test apps/desktop/tests/lsp-ipc-handler.test.ts
bun test apps/desktop/tests/terminal-file-ipc.test.ts
# Full diagnostic commands, from apps/desktop (baseline errors described above):
bunx tsc --noEmit -p tsconfig.main.json
bunx tsc --noEmit -p tsconfig.preload.json
bunx tsc --noEmit -p tsconfig.renderer.json
bunx tsc --noEmit -p tests/tsconfig.json
```

Separate review covered windowless states before validation and after native
closure, early/late events, duplicate listeners/clicks, timeout behavior, stale
renderer responses and startup notifications, generic-versus-signature recovery,
platform-specific sequencing, and signature verification. No validation or
requirement was disabled or weakened. No installed applications, release feeds,
Keychain, credentials, other worktrees, or running SuperiorSwarm instances were
modified or invoked.
