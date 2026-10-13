# Codex chat scrolling fix — 2026-10-09

> Reassessment, October 13: the earlier speed changes overcorrected. The
> implementation and passing tests described below are historical evidence,
> not release acceptance. The recovery plan at the end supersedes the earlier
> speed recommendation and identifies remaining gaps in unmerged PR #155.

## Confirmed cause

Switching workspaces can unmount the terminal renderer. Previously, attaching
again replayed only the last 200,000 raw output characters from the daemon.
Codex's repeated prompt redraws could consume that entire budget without keeping
any of the commands that originally built the conversation history.

An isolated xterm 6.0.0 reproduction wrote 300 numbered messages followed by
6,000 synchronized prompt redraws. The live terminal retained 277 scrollback
rows; restoring the raw suffix retained zero. This defect predates the October
wheel change (`fbd95c61`, PR #148); the raw limit dates to `a90aa691` in July.

After the user identified this chat as affected, inspection of its running
terminal found normal-buffer mode, mouse tracking off, and only seven scrollback
rows (`baseY=7`, 59 screen rows). This confirmed that the older history was absent
in that instance. No conversation contents were saved as diagnostic fixtures.

The prior pixel-baseline test also had a gap: Chromium's synthetic WheelEvent
exposes zero legacy wheel fields, which xterm reads before deltaY. Both compared
terminals were effectively receiving no movement. The fixture now exercises the
standard fields and checks that the viewport actually moves.

## Implemented changes

- `src/daemon/terminal-replay-buffer.ts` maintains a headless xterm matching the
  renderer's Unicode width rules and 10,000-line scrollback. Attachments and
  persistence use rendered snapshots, so cursor redraws no longer evict history.
  Exceptionally large styled histories are reduced by whole rows toward an
  8,000,000-character serialization budget.
- `src/daemon/terminal-output-framer.ts` holds incomplete escape sequences and
  surrogate pairs until they can be parsed and published together. Unterminated
  strings are bounded to xterm's 10,000,000-character payload limit.
- `src/daemon/pty-manager.ts` publishes output after parsing, establishing a
  consistent snapshot/live-output boundary. It orders resize operations, drains
  pending output before exit persistence, and retains the legacy raw attach
  format for old clients. Large live output is split into compatible frames
  without splitting Unicode surrogate pairs.
- `src/shared/terminal-replay.ts` wraps snapshots with original dimensions in an
  OSC envelope that other terminal readers can ignore.
- `src/renderer/components/terminal-replay.ts` resets and resizes in parser order,
  then restores the current pane dimensions. Repeated attaches do not append
  duplicate history. `Terminal.tsx` suppresses temporary resize IPC and device
  responses during replay.
- Snapshot restoration covers normal and alternate text buffers, styles, cursor
  positioning/visibility, scrolling regions, and the common input modes,
  including SGR mouse encoding. The headless terminal never sends device-query
  answers to the PTY.
- The normal wheel sensitivity is now 3 instead of 1. The line adapter honors
  this setting, restoring a three-row step; page events remain one page and
  Alt acceleration is applied once. Pixel movement remains owned by xterm.

## Follow-up: scrolling speed after 0.23.1

The installed 0.23.1 app contained the sensitivity-3 change, but inspection of
the running Codex pane now found `buffer=alternate`, `mouseTrackingMode=any`,
and `encoding=SGR`. This differs from the normal-buffer instance inspected for
the history-loss issue. The prior fix did not cover this application-owned path.

The release comparison confirms that 0.23 added the line/page adapter in
`fbd95c61`. That adapter explicitly bypassed mouse tracking and pixel events.
The xterm version and its default sensitivity did not change from 0.22 to 0.23;
the underlying application-wheel cap is also present in 0.22. There is no
evidence that 0.23 introduced that upstream cap. The adapter and the subsequent
sensitivity-only fix both left the relevant path untouched.

In xterm 6, application pixel deltas below 50px receive 0.3 damping, and the
calculated row count is used only as a yes/no gate: at most one arrow/mouse
report reaches the program per event. Increasing sensitivity does not remove
that cap. See [xterm issue #6105](https://github.com/xtermjs/xterm.js/issues/6105).

The adapter now normalizes alternate-screen pixel input and SGR/SGR-pixel wheel
input into proportional, bounded repetitions through `Terminal.input`. It uses
the measured cell height, accumulates fractional movement, preserves modifiers,
and resets fractions on direction, buffer, encoding, or geometry changes.
Vertical trackpad movement can include small horizontal deltas. Public parser
hooks observe mouse encoding changes; clicks and pointer motion remain owned by
xterm. Normal-buffer pixel scrollback and legacy binary/X10 behavior remain
unchanged. Listener replacement retains the encoding for the same terminal.

`tests/terminal-wheel-native.test.ts` injects trusted wheel events through
Chromium's input dispatch, preserving the browser's native legacy fields. At
18px cell height and sensitivity 3:

| Input | Previous application path | Fixed application path |
| --- | ---: | ---: |
| Ten -4px events | 1 report | 6 reports |
| One -120px event | 1 report | 20 reports |

These results cover alternate arrow input, SGR, and SGR pixels. Normal terminal
scrollback matches its baseline. The running pane was also given a temporary
copy of the fix: a 120px probe generated 19 reports at its measured geometry.
The probe intercepted `Terminal.input`, so it did not send test input to the PTY.
The temporary handler is cleaned up when that terminal is disposed; the source
change is required for persistence and other panes.

Validation: 22 tests passed across the wheel, native Electron, and input-routing
files. The native test includes 24 mode/sensitivity/input combinations. The
focused TypeScript check and production build passed.

## Compatibility and activation

`terminal-snapshot-v1` is an additive daemon capability. New clients request
snapshots only when advertised, and accept the larger replay frame. Old daemons
and old persisted raw buffers remain readable. An outdated daemon is upgraded
when idle; live sessions are preserved rather than terminated to upgrade it.
Installing a new renderer alone cannot enable native snapshots on an
already-running old daemon. The updated terminal service must also start for
that capability. The compatibility layer described below now preserves state
in the app's main process while an old daemon remains alive.

History already discarded by the old daemon cannot be reconstructed from that
raw suffix. Resuming the Codex session once after upgrading can rebuild its
transcript from Codex's own saved session data. No live user chats were killed,
restarted, or submitted to during implementation.

Snapshots preserve terminal text state. The upstream SerializeAddon does not
serialize inline image payloads or OSC 8 hyperlink destinations; plain URLs
remain recognizable by the renderer's WebLinksAddon. This is a limitation of
restored snapshots, not live rendering. Headless history adds memory bounded by
terminal dimensions and the retained line count.

## October 12: returning to a chat and Cmd+W

The installed app was 0.23.2, but its production daemon was still the process
started September 29. Its live handshake was `protocolVersion: 2` with no
capabilities, and it still owned 33 PTYs. Thus the earlier native-daemon snapshot
fix was not active for these sessions. Two affected Codex replay responses each
contained 200,000 characters and `fg=codex`, but no alternate-screen or mouse
tracking/encoding setup sequences. A recreated xterm starts in normal mode with
mouse reporting disabled, while the existing Codex process still expects SGR
wheel input. Showing the latest screen does not restore that input state.

`src/main/terminal/view-sessions.ts` now retains a headless terminal and the live
daemon subscription for a viewed legacy session. Leaving a workspace detaches
the renderer only. Output continues to update the retained terminal, and a
returning renderer receives a serialized snapshot before newer live output.
Snapshot-capable daemons keep their existing direct attach/detach path. Tab
closure, process exit, resize ordering, stale shell modes, and cancelled view
attachments are covered. Disposing a replay buffer settles pending writes so
closing a view cannot leave an attachment promise hung.

This is an app-process cache for legacy daemons. It cannot reconstruct mode
setup/history already missing when the app first attaches to an old raw replay,
nor can it provide a durable daemon snapshot across quitting the app. A chat
already in that broken state needs one Codex resume after the updated app starts;
subsequent view changes retain the restored state. Native daemon snapshots still
provide the durable path after the old service can be replaced.

The Cmd+W action also had a separate resource leak: it called only
`removeTabFromPane`, whereas the tab's close button first disposed the PTY.
That left invisible processes keeping the old daemon alive. Both paths now use
`closeTabWithTerminalCleanup`. The main dispose handler clears workspace links
to the specific closed terminal. Layout moves and ordinary navigation remain
non-destructive. Existing background/orphaned PTYs were not killed during this
investigation.

Verification:

- The legacy return-to-chat regression failed before the change: expected
  `alternate`, received `normal`, despite the latest text being visible.
- Three leave/return cycles now preserve alternate screen, mouse tracking,
  SGR encoding, normal-buffer history, and output written while hidden.
- Native Chromium wheel input after the recreated legacy view produces the
  expected 20 SGR reports for the test's 120px movement. The native matrix now
  contains 24 baseline/application cases plus the legacy return case.
- Cmd+W's regression failed before the change with zero disposal calls; it now
  disposes the selected terminal before metadata removal and leaves other
  terminals/non-terminal tabs alone.
- 149 tests passed in the combined focused run. Its real-PTY test hit a Bun
  bundler `EISDIR` error; rerunning that test in isolation passed. The earlier
  daemon-focused batch also passed all 66 tests, including that PTY test.
- The production build and focused terminal TypeScript check passed. Full
  repository type checking still reports unrelated existing errors.

## Validation

### Follow-up: built daemon startup

The first implementation used a named `Terminal` import from `@xterm/headless`.
The Bun-bundled tests accepted it, but electron-vite externalizes dependencies;
Electron's native ESM loader could not infer that export from the published
CommonJS package. The daemon exited before creating its socket, producing the
reported "Daemon not connected" errors in local development.

The runtime import now uses the package's default export. Added
`tests/daemon-built-startup.test.ts`, which builds the actual daemon source with
the Electron/Vite configuration and external dependencies, starts it with
Electron in Node mode against an isolated database/socket, creates a real PTY,
and verifies a rendered-history replay. It reproduced the exact startup error
before the import correction and passed afterward. This test plus replay and
PTY tests passed: 13 tests, 37 assertions. The focused type check also passed.

### Original scrolling validation

- 133 tests passed across 11 focused files, with 454 assertions.
- Real Node/node-pty process: history survives redraw traffic beyond the old raw
  limit, detach/attach, resize, continued output, and final-output persistence.
- Isolated Electron 40.8.5 / Chromium 144: full 10,000-line history, ongoing
  output, prompt redraws, replay across pane sizes, queued output, consecutive
  snapshots, and scrolling after restore.
- Snapshot unit tests: Unicode/escape fragments, normal/alternate buffers,
  cursor and input modes, scrolling regions, and snapshot/live-output ordering.
- Client tests: capability negotiation, replay beyond the old frame limit,
  reconnection, and legacy compatibility.
- `bun run build` passed.
- `bunx tsc --noEmit -p tests/tsconfig.terminal-replay.json` passed.
- Full application type checking remains blocked by existing errors in unrelated
  AI-review, database, GitHub, and renderer code. No reported errors refer to the
  changed terminal files.
- Graph refresh is unavailable locally because the `graphify` Python module is
  missing. `git diff --check` passes.

## October 13: full reassessment and recovery plan

Status: investigation and implementation plan only. No product code changed
during this reassessment. Reviewed v0.22.0, v0.23.0, v0.23.1, v0.23.2, and the
unmerged compatibility change `ef275600` in PR #155. The later file-input fixes
on main were inspected separately; they are not part of the shipped 0.23.2
scrolling behavior.

### Required outcomes

1. A healthy terminal remains usable after prolonged output, ordinary tab or
   workspace navigation, resize, and supported reconnects. Both wheel input
   and keyboard input continue to reach the correct session. No routine chat
   restart should be necessary.
2. Default mouse and trackpad movement returns to the pre-0.23 baseline where
   that input already worked. Missing mouse bytes and incorrect event units
   are fixed without a global speed increase or application-specific guesses.
3. Existing installations receive the relevant fix. App version alone does
   not establish the version or capabilities of their surviving daemon.

### Reevaluate the changes individually

| Change | Evidence and decision |
| --- | --- |
| 0.23.0 `fbd95c61`: onBinary → preload → main → daemon → PTY | Keep. Before this change, legacy mouse reports were discarded. Encoding high-bit coordinates as UTF-8 is not a valid substitute. This is the directly demonstrated mouse-support defect. Test delivery through the actual daemon, including unsupported old-daemon capabilities. |
| 0.23.0 line/page normalizer | Keep standard-unit correction for normal terminal scrollback: line units once, page units once. Return full-screen/application scrolling to stock xterm behavior for the initial recovery release. The custom repeated-arrow/application behavior needs a separately demonstrated requirement before returning. Pixel events are not a reliable mouse-versus-trackpad discriminator. |
| 0.23.0 ordered text/binary input queue, plus large-paste follow-up | Preserve byte ordering and paste delivery, but repair cancellation/accounting. The new shared queue budget can temporarily reject input for other terminals after the blocked terminal is invalidated. Do not replace this with unordered writes. |
| 0.23.0 terminal file features | Separate feature, but review its integration points: create/attach validation, `[id, workspaceId]` effect lifecycle, file-paste capture, Enter handling, visibility, and wake. Inspection found no file-drop wheel listener or persistent paste capture: capture is synchronous and cleared in `finally`. That is not an end-to-end exclusion of lifecycle problems. Preserve file functionality and add lifecycle coverage rather than reverting it indiscriminately. |
| 0.23.1 `107421a6`: rendered daemon snapshots | Keep the state-preservation objective and current native snapshot path, subject to full lifecycle/performance tests. Raw suffix replay demonstrably loses history and input modes. The additional parser, framing, serialization and storage costs need bounds and stress checks. |
| 0.23.1 sensitivity 1 → 3 | Revert. The previous default was 1. This was an acceleration, not restoration of a previous default. It also changes already-working trackpad scrollback. |
| 0.23.2 `edcb1391`: repeated application reports / removal of damping | Revert the custom application-wheel path. It amplified motion and introduced sharp differences between event paths. SGR reports are commands whose effect is chosen by the application, not screen rows. |
| PR #155: main-process replay cache for old daemons | Do not merge unchanged. Warm workspace switching is covered, but cold restoration is still incomplete, reconnect replay duplicates retained history, and per-chunk promise serialization adds substantial delay. Revise and test this path independently of speed. |
| PR #155: Cmd+W cleanup | Keep. Keyboard closure previously removed the view without disposing the PTY. It can leave invisible sessions keeping the old daemon alive. Closing, hiding, and moving must remain distinct operations. |
| Built daemon CommonJS import fix | Keep and retain the actual Electron-built startup test. Bun-only tests missed the import error that prevented the daemon from creating its socket. |

### What is known about the lockup

**State loss after remount is reproduced.** The old daemon keeps the last
200,000 raw characters. Repeated redraws can evict the earlier conversation
and the alternate-screen/mouse setup. Workspace navigation disposes the xterm
view; returning reconstructs it from that suffix. A latest-looking screen can
therefore have no local history and no mouse reporting while the live Codex
process still expects mouse reports. Earlier on-device inspection found
exactly missing setup in affected old-daemon replays.

The raw replay limit and workspace remount behavior predate 0.23. This does
**not** prove that every lock reported since 0.23 has that cause. The release
also changed input delivery and terminal integration. Merely finding an older
bug is insufficient to dismiss the reported regression timeline.

Top tabs within a pane normally remain mounted with CSS visibility changes;
workspace changes can unmount them. A lock while continuously staying in one
mounted terminal, or after only a visibility toggle, needs a separate trace.
The optional user clarification about typing and navigation is still pending.

**New compatibility gaps reproduced during this review:**

- Feeding a legacy reconnect replay into PR #155's retained cache duplicated
  an existing 100-line history: normal scrollback changed from 77 to 177 rows,
  and `line 0` appeared twice. The probe invokes the same replay callback used
  by DaemonClient after reconnect; it does not simulate a real socket outage.
- First attachment to a previously truncated Codex replay still restores
  `normal` buffer, `mouse=none`, and zero scrollback. A new cache cannot infer
  missing setup or reconstruct discarded text.
- A burst of 2,000 small redraw chunks, totaling 58,000 characters, took about
  2,311ms through the legacy view queue versus 8.5ms through batched writes to
  the same underlying parser in Electron's Node runtime. This isolates the
  per-chunk await/timer overhead. It is not a measurement of live user latency,
  and this unmerged code cannot explain a shipped 0.23.2 regression.
- Holding the input wake gate and enqueueing 1,024 inputs, then invalidating
  that terminal, still rejected input to another terminal until the original
  gate completed. This demonstrates retained global admission accounting, not
  proof that a user's wake gate has hung. The production transition wait has
  a five-second bound; a permanent hang must not be asserted from this probe.

The existing 24 replay/view/input tests pass, as does the isolated real-PTY
replay test. These passing tests do not cover the new failures above.
Scratch probes and results are in `/tmp/ss-scroll-deep-audit/` on this machine.

### What is known about speed

The pinned xterm version, font configuration and smooth-scroll default did not
change between the release baselines. Two explicit application changes explain
the newly excessive speed: global sensitivity 3 and application report repeats.

Isolated Electron comparisons used the exact tagged wheel handlers, the same
terminal geometry (18px rows), and controlled browser-injected events. They are
not physical device traces. The prior release-audit scripts/results are in
`/tmp/ss-scroll-release-audit/` on this machine.

| Input / observation | 0.23.0 | 0.23.1 | 0.23.2 |
| --- | ---: | ---: | ---: |
| Normal scrollback, 90 precise 4px events with proportional legacy fields | 25 rows | 80 rows | 80 rows |
| SGR application mode, one 120px event | 1 report | 1 report | 20 reports |
| SGR application mode, 90 events of 4px | 5 reports | 17 reports | 60 reports |

The 0.22.0 pixel cases matched 0.23.0 in these comparisons. In 0.23.2, changing
horizontal delta from 120 to 121 while holding vertical delta at -120 changed
the SGR result from 20 reports to 1: the guard switches between the custom and
native paths. Large-event caps also depend on terminal height: a 1,200px event
produced 23 reports at 24 rows and 59 at 60 rows.

The former acceptance test derives expected report counts from the same new
formula and asserts that they exceed the baseline. That verifies implementation
arithmetic, not acceptable transcript movement or device feel.

### Implementation sequence

1. **Create a reproducible failure and diagnostic baseline.**
   Add an isolated Electron fixture using the actual Terminal React component,
   preload dispatch, main IPC and a disposable PTY/daemon. Drive real workspace
   switches and top-tab visibility changes, including rapid A→B→A navigation.
   Use numbered transcript output plus full-screen mouse-mode output and exceed
   the old raw replay budget with redraws. Run against the last-known baseline,
   shipped 0.23.0/0.23.2 behavior, and the proposed patch.

   Add an opt-in, bounded diagnostic snapshot recording buffer type,
   baseY/viewportY, mouse mode, dimensions, renderer generation/visibility,
   replay gate depth/age, daemon capabilities, input acceptance/rejection reason,
   and pending parse/input counts. Record counts and modes, not chat text or
   typed input. This distinguishes missing history, lost modes, suppressed input,
   disconnected transport, and backlog. A mounted-view lock remains a required
   investigation if the remount reproduction does not explain it.

2. **Restore conservative speed behavior in a separate change.**
   Set scrollSensitivity back to 1. Remove custom SGR encoding observation,
   pixel-to-report multiplication and repeated application arrow navigation;
   delegate application wheel behavior to pinned xterm for this recovery.
   Restrict custom unit correction to normal scrollback without mouse tracking.
   Keep binary input delivery, local event ownership, bounds, and cleanup.
   Preserve the established fast modifier and direction settings. Do not add a
   device guess, new global multiplier, animation, or preference to compensate.

3. **Finish reliable state restoration, including the upgrade path.**
   Keep native daemon snapshots as the authoritative state when supported.
   Assert that normal history, alternate buffer, mouse tracking/encoding and
   geometry survive restore, and that subsequent wheel input reaches the PTY.
   Snapshot tests must verify behavior after restore, not only visible text.

   For old daemons, keep the continuous output subscription across ordinary
   navigation, but replace per-chunk promise waiting with ordered batched parser
   writes and explicit attach/resize barriers. Bound backlog and expose failures;
   do not silently discard state or let unbounded work delay the returning view.

   Track connection/session generations and state validity. A raw replay after
   a transport gap is not new live output and must not be appended to an already
   parsed cache. Rebuild in isolation from authoritative state where available.
   For a legacy raw suffix that cannot establish complete state, mark recovery
   required instead of presenting it as a healthy snapshot. Do not invent mouse
   modes from the foreground process name, or try to deduplicate arbitrary ANSI
   streams using text overlap.

   Provide a deliberate recovery path for an already-corrupted old session.
   Use an existing recorded Codex session ID to offer a per-chat resume where
   available; otherwise explain how to resume without guessing the command.
   Do not silently terminate active work. Surface that the old service still
   lacks required capabilities and use the existing idle-only daemon replacement
   when its live sessions have been closed. Validate this upgrade workflow with
   old and new daemon binaries. An old daemon cannot be hot-upgraded simply by
   opening a new tab, and already-discarded bytes cannot be restored by a wheel fix.

   The legacy cache is only a bridge while that old service remains. App quit or
   an output gap can invalidate it again; a one-time chat resume alone is not a
   durable upgrade. Do not claim all legacy reconnect/relaunch cases are fixed
   until the supported recovery/daemon-upgrade workflow has been exercised.

4. **Close input/lifecycle holes without changing scroll distance.**
   Cancellation on detach, close or disconnect must release pending queue budget
   immediately and exactly once, while preventing cancelled writes from reaching
   a replacement session. Keep FIFO ordering for valid text and binary input.
   A blocked terminal must not exhaust admission for all other terminals. Trace
   wake delays and explicitly report transport rejection; never replay stale
   wheel bursts on reconnection or inject them into a newly resumed shell.

   Make replay suppression exception-safe and scoped to the current view; a
   failed/disposed restore must not leave input or resize permanently suppressed.
   Test asynchronous create/attach failures and old cleanup callbacks against a
   new view of the same terminal. Preserve the Cmd+W/close-button disposal fix;
   navigation and tab moves must never dispose a PTY.

5. **Validate the actual outcomes before another release.**
   Treat the following as release gates, not optional follow-up work. Keep speed
   rollback and lifecycle fixes independently reviewable and verify them together
   in the built application, including the still-running legacy daemon case.

### Release acceptance

| Scenario | Required evidence |
| --- | --- |
| Prolonged live output, then 100 workspace leave/return cycles | History and modes survive each transition; wheel and typing still work; no need to restart a healthy chat. Include a 30-minute mixed idle/output run. |
| Top tabs hidden/shown, split/move/resize, rapid navigation | Exactly one current input/output owner; no stale detach deleting the replacement; stable geometry and correct viewport. |
| New daemon, existing snapshot daemon, old raw daemon | Test separately. Warm legacy navigation works; cold/gapped legacy restoration either recovers through the explicit supported workflow or visibly identifies the remaining compatibility limit. App version is not the capability check. |
| Real socket loss/reconnect and app relaunch | No duplicated history, lost input modes, stuck replay gate, stale keystrokes, or unbounded queues. No automatic termination of active work. |
| Output burst / many hidden sessions | The 58KB/2,000-chunk case no longer incurs seconds of per-chunk delay; target under 100ms on the same test machine. Under sustained input/output, backlog drains and memory returns to a stable plateau. |
| Wake cancellation / backpressure / failed create | Other terminals remain responsive; queue accounting returns to zero; the current view has an explicit error/recovery state instead of silently ignoring input. |
| Physical trackpad and detented mouse | Same Codex/Claude versions, settings, font, pane size and OS settings for baseline/candidate. Test slow motion, individual notches, repeated notches, fast movement, inertia, reversal and stopping. Normal scrollback distance within 5% or one row of baseline for unchanged pixel inputs. |
| Actual full-screen Codex and another TUI | Compare visible transcript movement and stopping, not just report count. No 20-for-1 bursts or diagonal speed discontinuity. Verify legacy binary encoding at coordinates above 127 and SGR independently. |
| Mouse originally reported broken | Confirm its actual event fields and terminal mode. Demonstrate bytes arriving correctly and visible scrolling. If a low-delta mouse still needs tuning, treat that as a separately measured case rather than increasing everyone's default speed. |
| Build/distribution | Production build, focused checks, real Electron-built daemon startup, fresh install, and upgrade with surviving sessions. Passing unit tests alone is insufficient. |

The release decision requires both goals to pass independently. Reverting speed
does not repair lost terminal state, and successful reattachment does not prove
the new speed feels normal. Missing physical-device evidence or an unexplained
mounted-view lock must remain explicit, rather than being hidden by another
blanket scrolling adjustment.

## October 13 implementation and verification

Implemented the approved recovery work after the user reported another locked
view. Read-only inspection found the production daemon was still the September
29 process, protocol 2 without capabilities, with 40 PTYs. Both Codex terminals
in the fix-scroll workspace returned 200,000-character suffixes containing only
synchronized-update/cursor-visibility mode changes, without alternate-screen or
mouse setup. Computer-use actions failed, so the exact renderer state was not
independently inspected this time. No live PTY was restarted or given test input.

Changes now implemented:

- Default sensitivity is 1. Normal pixel and all application wheel paths stay
  with xterm; custom handling is limited to normal-scrollback line/page units.
  Removed manual SGR encoding tracking and repeated application reports/arrows.
- Legacy view output is batched between ordered attach/resize barriers. Reconnect
  replay starts a fresh parser baseline instead of appending to retained state.
  Pending legacy output is bounded; exceeding the bound produces an explicit
  recovery state and keeps the PTY alive for a deliberate view reload.
- Cold/reconnected legacy replays are identified as potentially incomplete.
  The UI offers a recorded, quoted resume command when available, diagnostics
  without transcript/input content, and view reload for parsing/delivery failures.
  Unsupported old-daemon binary mouse input is explained instead of silently lost.
- Replay cancellation/failure settles completion exactly once. Unmounted views
  cannot keep input suppressed, and initial/observer fits respect restoration.
  Old preload cleanup callbacks cannot remove a replacement listener.
- Cancelled input releases its allowance and payload immediately. Allowances
  are per terminal, with a cap on pending terminals and one oversized idle paste,
  so a blocked wake does not consume another terminal's allowance. False delivery
  is surfaced, including outbound backpressure; stale input is never retried.
- Kept the original binary-input fix, native snapshots, and Cmd+W disposal.
  Merged the current main branch's independent file-input fixes.

Evidence:

- Before these changes, new regression tests failed on duplicate reconnect
  history (77 became 177 rows), the roughly 2.3-second burst delay, and cancelled
  input retaining shared admission. They pass after the change; the burst case
  completed in about 14ms in the focused run.
- 49 trusted Chromium input cases now compare against stock xterm at sensitivity
  1, including diagonal movement and restored legacy views. Binary encoding,
  high-bit coordinates, replay suppression, and long scrollback checks pass.
- A new fixture uses the actual Terminal React component, production preload,
  terminal IPC, real sockets and a real raw-mode PTY program. Both modern and
  legacy variants pass 100 unmount/return cycles, hidden-tab transitions, normal
  history checks, keyboard and wheel delivery, and reconnection. The final short
  fixture also verifies rejected disconnected input is reported without delayed
  delivery, and high-bit binary mouse bytes reach a capable PTY unchanged.
- Both cache/navigation variants completed 30-minute soak runs, each adding 866
  output/idle/navigation cycles after the initial 100. Sampled queues and replay
  gates were empty and modes remained correct. Main-process RSS fluctuated rather
  than rising monotonically: legacy 150–205MiB, ending 163MiB; modern 118–192MiB,
  ending 124MiB. These are main-process samples, not total renderer/GPU memory.
  The soak started before the final delivery-error notices and input-allowance
  follow-up; those paths were checked in the final short/integration tests.
- 79 transport/replay tests passed in the broader focused batch; final cancellation
  and view tests passed 22 tests. The real Electron/Vite-built daemon starts and
  produces a valid snapshot. The production build, focused terminal type check,
  and preload type check pass. Full repository type checks retain existing errors;
  none were reported in the changed paths. Biome reports no errors, with existing
  non-null-assertion warnings retained. `git diff --check` passes.

Remaining release checks:

- Physical mouse and trackpad feel has not been validated by a person on the
  affected devices. Browser-injected baseline equivalence is not a hardware test.
- Legacy file-insertion checks intermittently fail their native process-identity
  probe before insertion. The same first-probe failure was reproduced with the
  unmodified main-branch client (6 passed, 1 failed); this is not newly introduced
  by the scrolling patch. Current-daemon insertion and isolated diagnostic runs
  passed. Record the failures rather than claiming an entirely green file-input
  suite; they need follow-up before release.
- Already-missing legacy history/modes are not recoverable from the suffix. The
  recovery guidance does not hot-upgrade a running daemon. Finish/resume affected
  chats as needed; finish and close older sessions, then reopen the app to allow
  the existing idle-only service upgrade. Do not terminate active work silently.
- PR #155 remains a draft for these release checks. No release/tag/deployment was
  performed. Graph refresh is unavailable because the Python graphify module is
  not installed; normal Git hooks ran and reported that limitation.
