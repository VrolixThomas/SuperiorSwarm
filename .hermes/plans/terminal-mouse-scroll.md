# Terminal mouse-wheel scrolling: investigation and implementation plan

Date: 2026-10-01. Worktree: `investigate/terminal-mouse-scroll`.
Baseline: `e3799ca6b4fb5221c1130b422cc773893b1d24ad` (desktop package 0.22.0).
Status: investigation complete; implementation and hardware verification pending.

## Decision

Do not ship a blanket sensitivity increase or browser-wide wheel interceptor. There are different wheel pipelines, and the evidence does not establish which one the reporter was using. Implement and validate the mode-specific changes below, starting with the confirmed missing binary-input bridge. For scrollback, preserve the working pixel-event pipeline and normalize only line/page events locally. For application scrolling, preserve application ownership and address the upstream quantization separately; a scrollback normalizer cannot fix it.

The strongest match for *slow* scrolling is xterm 6's application-input path: small pixel deltas are damped and accumulated, while large deltas become at most one application input event. The strongest confirmed explanation for *broken* scrolling is the missing `onBinary` bridge when a terminal application selects legacy mouse encoding. Neither explains an ordinary shell scrollback failure by itself. A page-unit bug is confirmed in upstream viewport arithmetic, but whether affected hardware emits page units remains unknown.

## Investigation boundaries and evidence quality

- Read `CLAUDE.md` before product source. No `AGENTS.md` was found in the worktree or inspected parent chain. The user's read-only constraint overrides the repository's request to update/commit its instruction index. Graph report inspected; Graphify was optional and was not rebuilt.
- Initial Git status was clean. No product source, tests, configuration, generated files, dependencies, history, running app, PTYs, credentials, or unrelated processes were changed. The only saved artifact is this plan; do not commit it.
- No local `node_modules` exists at the root or desktop package. No installation, build, app launch, restart, or live-session injection was performed.
- Executed dependency-free existing tests and in-memory Bun harnesses. Harnesses fetched tagged upstream TypeScript, transpiled selected methods with `Bun.Transpiler`, and supplied mock dimensions/events/output sinks. Nothing was downloaded to a file or installed.
- Confirmed means source inspection and/or executable arithmetic/routing evidence. Physical-device behavior, event frequency, event target, and application mode of the reporter were **not measured**. Synthetic objects are not trusted hardware events, and the harness did not exercise Chromium layout, DOM propagation, native coalescing, GPU rendering, or a PTY.
- Lockfile versions describe this checkout, not an independently inspected installed application bundle. Capture actual runtime versions during hardware validation.

## Owning stack and files

All paths below are repository-relative. Line numbers describe the baseline; use named functions when implementing.

| Layer | Owner | Observed behavior |
| --- | --- | --- |
| Electron host | `apps/desktop/src/main/index.ts`, `createWindow`, about line 104 | BrowserWindow with isolated preload, no node integration. No wheel injection, zoom adjustment, or `before-mouse-event` interception found. `main-window.ts` only stores its reference. |
| React layout | `src/renderer/App.tsx`; `components/panes/PaneContainer.tsx`, `PaneContent.tsx:32` | Terminal tabs remain mounted in absolutely positioned wrappers; active tab uses CSS visibility. Pane focus changes on mousedown, not wheel. Ancestors use overflow containment. |
| Other terminal consumers | `components/review-mode/TerminalDrawer.tsx`, `TerminalDrawer` / `TerminalTab` | Same Terminal component; drawer has a small resize overlay. These consumers omit the currently required `active` prop; record as a visibility/lifecycle concern, not a demonstrated wheel cause. They were found as exported consumers; live reachability was not established. |
| Terminal lifecycle | `components/Terminal.tsx:74`, mount effect | One xterm per id; loads addons, opens terminal, schedules fit/focus, subscribes to PTY, disposes on unmount. `active` only drives `setVisible`; it does not install scrolling behavior. |
| Options | `Terminal.tsx:80` | 13 px font, SF Mono/Menlo/Monaco/Courier New fallbacks, lineHeight 1.2, 10,000 scrollback lines, proposed API enabled. No app-set sensitivity, smooth duration, windowsPty, screen-reader, or wheel override options. |
| Addons | `Terminal.tsx:94–122`; `bun.lock:582–598` | Fit 0.11.0; Search 0.15.0; WebLinks 0.12.0; Clipboard 0.2.0; Unicode11 0.9.0; WebGL 0.19.0; Image 0.9.0. Serialize 0.14.0 is declared but unused in this component. Search's lockfile peer range is xterm ^5; compatibility audit is separate, with no evidence it causes wheel loss. |
| Rendering | `Terminal.tsx`, WebGL initialization / `applyTheme` | WebGL after open, DOM fallback after failure/context loss; Image after renderer. Theme and resize use animation frames. Neither is a wheel throttle. Fit determines rows/columns; actual cell height must be measured, not assumed to equal 13 × 1.2. |
| Styling | `src/renderer/styles.css:2,282–315` | Imports xterm CSS; container fills parent, xterm gets 4 px top/12 px left padding. No custom terminal line-height, scroll-behavior, wheel rule, or touch-action. Old `.xterm-viewport` background override does not govern v6's `.xterm-scrollable-element`; WebKit scrollbar styles do not tune its custom wheel arithmetic. |
| xterm dependency | `apps/desktop/package.json`; `bun.lock:598,822,1304` | xterm exactly 6.0.0 in lock; Electron 40.8.5; node-pty 1.1.0. Electron 40.8.5 contains Chromium 144.0.7559.236 ([release](https://releases.electronjs.org/release/v40.8.5)). |
| Renderer output/input | `Terminal.tsx:154–281` | PTY output goes to `term.write`; terminal input goes from `term.onData` to `api.terminal.write`. **No `term.onBinary` subscription.** Replay suppresses outbound onData until parsing completes; reset stale modes on fresh restore, shell foreground attach, and exit. |
| Preload / main | `src/preload/index.ts:30–58`; `src/main/terminal/ipc.ts`, `setupTerminalIPC` | Actual terminal transport is dedicated `terminal:*` IPC, not tRPC despite generic repository guidance. Data dispatcher is keyed by id. Main validates writes and awaits `AgentSessionManager.beforeTerminalInput`. |
| Input wake gate | `src/main/services/agent-session-manager.ts:273` | Waits for transitions and wakes hibernated agents. Can delay application input, not local scrollback; no device-specific wheel logic. |
| Daemon client | `src/main/terminal/daemon-client.ts:363`, `write`, `buildWriteFrames`, `dispatchFrame` | String data in bounded JSON frames, backpressure queue. Input may fail disconnected or be dropped under queue exhaustion; no wheel-unit transformation. |
| Socket / PTY | `src/daemon/socket-server.ts`, `handleMessage`; `src/daemon/pty-manager.ts`, `create` / `write` | JSON write payload passed to `pty.write(string)`. Output is base64 UTF-8 transport back to renderer. Login shell, TERM xterm-256color. Daemon retains 200,000 characters; periodic DB flush is persistence, not renderer wheel throttling. |
| Mode recovery | `src/shared/lib/terminal-modes.ts` | Clears DEC tracking 9/1000/1002/1003 and encoding modes, focus reporting; caller exits alternate buffer conditionally. Does not indiscriminately reset a live foreground TUI. |
| Settings | `components/settings/TerminalsSettings.tsx`; `src/main/trpc/routers/settings.ts`; `stores/editor-settings.ts` | Terminal settings manage sessions/agent sleep; no terminal wheel preference. Editor settings are unrelated. |

`src/...` in this table means `apps/desktop/src/...` unless already fully specified.

## Two upstream pipelines, plus application encodings

### Normal buffer / local scrollback

The v6 viewport wraps the terminal screen in a custom scrollable element. Its non-passive listener feeds `StandardWheelEvent` to `_onMouseWheel`, changes scroll position, and requests buffer-row movement. Consumed events are prevented and stopped intentionally. The local app does not transform them a second time. Row rendering rounds the pixel position by measured CSS cell height. See [Viewport](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/Viewport.ts) and [scrollable element](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/vs/base/browser/ui/scrollbar/scrollableElement.ts).

`StandardWheelEvent` prefers legacy `wheelDeltaY` when present, normalized by 120. Without it, non-Firefox line deltas are used directly, while other modes divide by 40. The scrollable element then multiplies by 50 CSS pixels and rounds nonzero motion away from zero to a whole pixel. Thus modern-only page events get treated like pixels, not pages. A realistic Chromium diagnostic must record legacy fields as well as standard fields. See [normalization source](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/vs/base/browser/mouseEvent.ts).

### Application mouse tracking, in either buffer

For protocols with wheel support (VT200/1000, drag/1002, any/1003), viewport wheel handling is disabled and wheel goes to the application. `consumeWheelEvent` converts pixel movement using device cell height / DPR, applies 0.3 damping below 50 px, and retains fractional residue. Line units pass through; page units multiply by rows. The caller uses the result only as a zero/nonzero gate, then sends one report. Legacy DEFAULT reports emit `onBinary`; SGR/SGR_PIXELS emit `onData`. See [CoreMouseService](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/services/CoreMouseService.ts).

Encoding selection and tracking are independent. Enabling 1006 alone does not enable tracking. X10/9 reports presses but not wheel; do not treat every non-`none` tracking mode as wheel-capable. The public `term.modes.mouseTrackingMode` distinguishes these states.

### Alternate screen without wheel tracking

Alternate screen has no local scrollback. `CoreBrowserTerminal.bindMouse` converts an accepted wheel event to one Up/Down sequence, choosing CSI or SS3 according to application-cursor mode. Magnitude beyond acceptance is discarded. Missing dimensions and Shift yield zero; small pixel movement may accumulate across multiple events. Normal-buffer scrollback capability is different from whether any history currently exists. A normal shell with no history should not suddenly receive arrow keys. See [CoreBrowserTerminal](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts).

### Options and event ownership implications

- Defaults are `scrollSensitivity: 1`, `fastScrollSensitivity: 5`, `smoothScrollDuration: 0`. Smooth-scroll infrastructure exists, but duration zero means animation is not a supported explanation for current lag. [Defaults](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/common/services/OptionsService.ts)
- Normal viewport sensitivity scales both mouse and trackpad input. Alt multiplies it by fast sensitivity. In application mode sensitivity changes the acceptance threshold, but cannot produce more than one report per event in this version. Ctrl also enters its fast multiplier; Shift is rejected earlier.
- `fastScrollModifier` is not in v6's public terminal options, even though an internal default remains. Do not propose it as a supported public fix. [Versioned typings](https://github.com/xtermjs/xterm.js/blob/6.0.0/typings/xterm.d.ts)
- `attachCustomWheelEventHandler` alone cannot reliably intercept normal scrolling: the descendant viewport can consume the event before the outer terminal handler runs. Returning false is not a universal browser preventDefault. Application mode and normal scrollback need separate integration tests.
- xterm selection overrides concern mousedown, not a universal Shift-wheel escape from mouse mode. macOS Option selection depends on `macOptionClickForcesSelection`; other platforms use Shift. Preserve those semantics. [SelectionService](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/services/SelectionService.ts)

## Ranked causes and exclusions

| Rank | Finding | Confidence and scope |
| --- | --- | --- |
| 1 | Small-delta damping/accumulation and one-report-per-event application routing | Confirmed mechanism; probable match for the slow-wheel report **if a TUI owns scrolling**. Lower-frequency devices can generate fewer application steps than a higher-frequency gesture. Not a normal-scrollback mechanism. |
| 2 | Missing onBinary → PTY bridge | Confirmed integration defect for legacy wheel-report encoding. Completely lost input, not merely slow. Affects either device in that mode, so cannot alone explain device disparity. |
| 3 | Page-unit viewport normalization | Confirmed arithmetic defect for modern-only page events: delta 1 becomes 2 px rather than a viewport. Relevance to actual hardware is unconfirmed. |
| 4 | Small pixel deltas / legacy-field magnitude in normal mode | Plausible: low-speed mouse hardware or driver settings can emit small pixel values. Standard line deltas are **not** reduced to tiny increments here. Need actual browser event capture before choosing gain. |
| 5 | Stale mouse mode / replay suppression / hidden sizing / overlay target | Plausible contextual failures; existing recovery addresses several. No evidence of persistent occurrence. A modal/drop overlay can legitimately receive the wheel instead of terminal. |
| 6 | Main/daemon wake, disconnection, backpressure, heavy rendering | Secondary possibility only for delayed TUI response or overloaded output. Local scrollback bypasses IPC. No evidence of a mouse-specific throttle. |

Searches across renderer/main/preload found no app wheel listeners, delta conversions, smooth-scroll implementation, or broad wheel cancellation. Trackpad-vs-wheel classification is not safely inferred from deltaMode: physical wheels may also deliver pixels. There is no confirmed double normalization in app code. There is upstream normalization followed by deliberate coordinate conversion; adding another blanket multiplier would create a new problem.

Upstream [issue 6105](https://github.com/xtermjs/xterm.js/issues/6105) independently reports the application-mode suppression. [PR 6118](https://github.com/xtermjs/xterm.js/pull/6118) was open when inspected; its proposed per-event bypass is not a released fix and may make high-frequency trackpads too fast. The v6 [release notes](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0) identify the new viewport and partial wheel tracking changes. Do not select a newer dependency merely by version number without rerunning the matrix.

## Executed reproduction matrix

Harness assumptions: 16 CSS px cell, 24 rows, DPR 2 unless stated, starting well inside scrollback, sensitivity 1, smooth duration 0. The 16 px cell is a chosen fixture, **not a measured application value**. Source methods executed: `StandardWheelEvent`, `_onMouseWheel`, `consumeWheelEvent`, and separately the encoders/`triggerMouseEvent`. Scrollable state and render services were mocked. No real timing was simulated; event count shows why frequency matters.

Modern-only events below omit deprecated fields unless specified. Viewport rows are rounded from accumulated pixel position; application count is accepted DOM events, not returned line sum.

| Input sequence | Local viewport change | Accepted application events | Interpretation |
| --- | ---: | ---: | --- |
| pixel +1 × 120 | 240 px / 15 rows | 2 | Small frequent movement eventually passes app gate; viewport rounds each event to 2 px. |
| pixel +4 × 10 | 50 px / 3 rows | 0 | Low-delta wheel can seem dead in app mode. |
| pixel +20 × 10 | 250 px / 16 rows | 3 | Most individual events suppressed. |
| pixel +40 × 10 | 500 px / 31 rows | 7 | Damping still active. |
| pixel +49 once | 62 px / 4 rows | 0 | Below heuristic threshold. |
| pixel +50 once | 63 px / 4 rows | 1 | Returns three lines internally, emits only one input. |
| pixel +100 × 10 | 1,250 px / 78 rows | 10 | Returned application amount totals 62, but only ten reports/arrows. |
| line +3 × 10 | 1,500 px / 94 rows | 10 | Normal line path is not tiny; app magnitude totals 30 but emits ten inputs. |
| page +1 once | 2 px / 0 rows | 1 | Page scroll broken locally; app amount 24 becomes one input. |
| pixel +100, wheelDeltaY -120 once | 50 px / 3 rows | 1 | Legacy field materially changes the viewport result. |
| pixel +4, wheelDeltaY -12 × 10 | 50 px / 3 rows | 0 | Legacy normalization can preserve small viewport movement. |
| pixel -20 × 10 | -250 px / -16 rows | 3 upward | Signed reversal works; do not invert again for natural scrolling. |
| pixel +20 × 10, DPR 1 / 2 / 3 | 250 px each | 3 each | With device cell height scaled consistently, DPR cancels correctly. |
| Alt + pixel 100 × 10 | 6,250 px | 10 | Fivefold local speed, still one application input per event. |
| Shift + pixel 100 × 10, mac fixture | 1,250 px | 0 | App gate suppresses; real OS Shift-wheel axis mapping not simulated. |
| sensitivity 3, pixel 100 × 10 | 3,750 px | 10 | Options-only cannot remove event-count cap. |

Encoder diagnostic at zero-based col 100, row 4, wheel down:

- DEFAULT emitted **onBinary**, bytes `1b 5b 4d 61 85 25`; existing renderer has no subscriber.
- Incorrectly forwarding that string as UTF-8 would produce `1b 5b 4d 61 c2 85 25`, corrupting coordinates.
- SGR emitted onData `ESC[<65;101;5M`; SGR_PIXELS emitted onData `ESC[<65;804;72M` for the supplied pixel coordinates.

Existing read-only test command, run from repository root:

```sh
bun test apps/desktop/tests/terminal-modes.test.ts apps/desktop/tests/terminal-paste.test.ts apps/desktop/tests/terminal-injection.test.ts apps/desktop/tests/terminal-links.test.ts
```

Result: **25 passed, 0 failed, 63 assertions**, Bun 1.3.9. These cover recovery strings, paste, links, and injected text, not browser wheel delivery. Did not run full suite: missing dependencies plus existing DB/socket/process tests violate this investigation's write/process constraints. `terminal-exit-message.test.ts` imports the component and unavailable runtime dependencies; it was inspected, not run.

## Native/platform interpretation

The OS and Chromium determine units, acceleration, and event cadence. Preserve browser-provided sign; macOS natural scrolling is already reflected in events. Do not consult or change system preferences. Wheel events can represent pixels, lines, or pages; the unit and magnitude are not a reliable hardware identity. [W3C WheelEvent definition](https://www.w3.org/TR/uievents/#interface-wheelevent)

xterm's Chrome legacy-DPR adjustment applies only through Chromium 122; locked Chromium 144 takes the newer branch. Do not divide standard CSS-pixel deltas by DPR again. In application mode the device cell height is divided by DPR to recover CSS cell height, a different operation.

Shipped packaging is macOS-oriented (`electron-builder.yml`, `dist --mac`). PTY resolution uses Unix shells/login arguments and Unix socket paths; native Windows support is not established. Windows/Linux wheel behavior below is a required renderer-level test/inference, not a claim of fully supported end-to-end Windows execution. Non-Mac xterm maps Shift-wheel vertically supplied motion to horizontal; horizontal scrolling is hidden. Linux also has a middle-click selection/paste branch unrelated to wheel speed.

## Implementation sequence and exact changes

These are proposed changes for a subsequent implementation task. None have been made.

### 1. Capture the failing mode before choosing a sensitivity fix

Use a disposable terminal harness with the locked xterm and actual Electron runtime, or a temporary DevTools observer in an already-running test app. Avoid modifying product files for capture. Never inject synthetic events into a user's live shell/TUI: they can execute application actions.

Capture a bounded in-memory ring of 256 events on the **one terminal container**, using a passive capture observer and a microtask to observe final cancellation. Record: event time/interval, isTrusted, type, deltaMode, deltaX/Y/Z, wheelDelta/X/Y if exposed, modifiers, cancelable, defaultPrevented before/after, target class, composed path, active element, DPR, zoom, public buffer type/baseY/viewportY, rows, `modes.mouseTrackingMode`, application-cursor mode, and local scroll/binary/data event counts. Observe output counts only, never command or terminal contents. A wheel-enabled protocol intentionally prevents default; that alone is not event loss.

Measure cell height using the rendered screen rectangle divided by rows, excluding outer padding. Diagnostic-only inspection of xterm internal render dimensions can cross-check this; do not introduce a product dependency on `_core`. Mark invalid/hidden/zero geometry, overlay target, and replay period separately. Remove observer and subscriptions after capture; do not patch global prototypes.

Capture isolated notches at roughly 2 Hz, faster notches, free spin, slow trackpad movement, and momentum. Compare matching total signed distance and event count. Determine whether failure is viewport movement, xterm report emission, IPC delivery, or application consumption. Reproduce over text, blank screen, scrollbar, and container padding; wrapper padding may lie outside the inner scroller's listener.

Release gate: if the affected device emits small pixel deltas in **normal** buffer, do not claim that line/page normalization or the application fix resolves its report. Use its trace to evaluate the options-only branch below, or retain the bug as unresolved pending a validated pixel policy.

### 2. Fix binary terminal input independently

Wire `term.onBinary` in `Terminal.tsx` beside onData, guarded by the same replay suppression. Do not feed binary mouse bytes to `CmdBuffer` or the Shift+Enter suppression flag. Dispose its subscription with the terminal.

Implement a byte-preserving transport, not `api.terminal.write(id, binaryString)` through the existing UTF-8 string path:

| File | Exact change |
| --- | --- |
| `src/shared/types.ts`, `TerminalAPI` | Add `writeBinary(id: string, data: string): Promise<boolean>`; data is xterm's byte-valued JS string. |
| `src/preload/index.ts` | Expose `terminal:write-binary` through the existing isolated terminal API. |
| `src/main/terminal/ipc.ts`, `setupTerminalIPC` | Validate id, byte-valued string (all code units ≤255), bounded input; apply the same agent wake/order behavior; call daemon binary write. |
| `src/shared/daemon-protocol.ts`, `ClientMessage` | Add `{type: "write-binary", id, data}` with base64 payload and bump protocol 2 → 3 for the changed wire behavior. |
| `src/main/terminal/daemon-client.ts` | `writeBinary`: convert Latin-1 string to bytes/base64, build frames below `MAX_FRAME_BYTES`, preserve ordering/backpressure with text writes, return false while disconnected. Extend input-frame/replay-protection discriminants to include binary writes. |
| `src/daemon/socket-server.ts`, `handleMessage` | Strictly validate bounded base64; decode to Buffer and invoke PTY write. Reject malformed payloads without crashing the socket. |
| `src/daemon/pty-manager.ts`, `write` | Accept `string | Buffer`; pass Buffer unchanged. |

node-pty v1.1.0 supports Buffer writes on Unix and Windows ([type](https://github.com/microsoft/node-pty/blob/v1.1.0/typings/node-pty.d.ts), [Unix implementation](https://github.com/microsoft/node-pty/blob/v1.1.0/src/unixTerminal.ts)). Keep normal Unicode keyboard/paste input as UTF-8 strings. Test high-bit bytes explicitly.

Protocol bump has an operational consequence: existing mismatch handling restarts the daemon and can lose live PTYs. Do not perform that migration silently in a release presented as merely scroll tuning. Ship this bridge as a separately reviewed compatibility change with a scheduled safe upgrade, or first design negotiated binary capability without restarting live sessions. **No daemon restart is authorized in this investigation.**

### 3. Add a narrowly scoped normal-scrollback normalizer

Add `apps/desktop/src/renderer/components/terminal-wheel.ts` with a pure `normalizeWheelToRows` helper and an `installTerminalWheelHandler` adapter returning cleanup. Integrate after `term.open` in `Terminal.tsx`; clean up before dispose. Keep options explicitly documented at 1 / 5 / 0 and scrollback at 10,000. Do not change font, CSS line height, scrollbar width, or Electron flags to compensate for units.

Use one native capture listener `{capture: true, passive: false}` on the component's `.xterm-container`, not window/document/React root. It precedes the nested v6 viewport listener. Inspect the public buffer/modes on every event. Guard out application-owned wheel protocols and alternate buffer, unknown/nonfinite data, horizontal-dominant motion, Ctrl/Meta gestures, Shift, already-prevented events, hidden/zero-size terminals, overlay/interactive targets, and noncancelable events. Do not require keyboard focus: hovering a visible terminal should scroll that pane without stealing focus.

Default handling is **line/page events only**. All pixel events pass unchanged to xterm, including fractional momentum, legacy-field handling, and OS direction. This is deliberate: do not guess device type from `deltaY < 50`, integer values, cadence, or a nonstandard legacy field.

Algorithm for handled normal-scrollback events:

```text
CSS cell height h = measured screen height / term.rows (cached, >0)
pageRows = max(1, term.rows - 1)
rawRows = deltaY                  if deltaMode == LINE
          deltaY * pageRows       if deltaMode == PAGE
          deltaY / h              if deltaMode == PIXEL (reference only; default delegates)
          invalid                otherwise
multiplier = 1 * (altKey ? 5 : 1)
boundedRows = clamp(rawRows * multiplier, -pageRows, +pageRows)
residue += boundedRows
wholeRows = trunc(residue)        // symmetric toward zero
residue -= wholeRows
term.scrollLines(wholeRows)       // only if nonzero; exactly once
preventDefault + stopImmediatePropagation on owned, cancelable event
```

The multiplier is applied once; never redispatch a modified WheelEvent through xterm. Do not read/write `.xterm-viewport.scrollTop`, mutate readonly event fields, or call private core methods. Clamp after converting units, not before. The clamp bounds an anomalous/coalesced event to one page; it does not impose a minimum on fractional motion. Overflow past the cap is discarded, not queued as a delayed jump.

Reset residue on direction reversal, unit/mode/buffer change, terminal-id change, disposal, or outward motion at a scroll boundary. Retain residue across slow events in the same mode/direction—an arbitrary timeout can recreate dead slow scrolling. Reset also when handing an event back to another wheel owner. If `baseY == 0`, no arrows are sent; consume owned line/page vertical motion within this terminal without moving ancestors. At top/bottom consume likewise and clear outward residue. Use `scrollLines` so xterm remains owner of scroll state and selection updates.

Cache geometry after fit/resize; avoid synchronous layout reads per event. For normal line/page handling the algorithm needs rows, not h. No animation/timer/debounce is necessary. If future pixel handling is approved, the same helper's pixel formula is available, but **do not enable it by default as part of this change**.

### 4. Treat application scrolling as a separate fix

A TUI using mouse tracking owns wheel input even while the normal buffer is active. Do not scroll the normal buffer behind it, force SGR mode, parse escape sequences with a second mode tracker, or inject hand-built mouse packets. Preserve xterm's coordinates, encoding, modifier bits, replay gate, and application-cursor selection.

Recommended progression:

1. Deliver the binary bridge for legacy reports and measure again. This alone fixes the demonstrated missing-delivery path.
2. For line/page alternate-screen input with tracking off, use `attachCustomWheelEventHandler` in `Terminal.tsx` to handle only these units. Normalize/clamp/accumulate using the helper above; emit the bounded count of Up/Down sequences through `term.input(sequence.repeat(count), true)` so the existing onData/replay path remains authoritative. Use public applicationCursorKeysMode. Prevent/stop the owned event and return false. Pixel events return true initially; no scrollback interception applies here. Confirm zero-sized alternate buffer does not accept synthetic navigation.
3. For wheel-reporting modes, keep the embedder out of encoding. Prepare a small version-pinned upstream fix/backport in xterm `CoreBrowserTerminal.bindMouse` (`sendEvent` wheel branch) and `CoreMouseService.consumeWheelEvent`: preserve normalized **line/page magnitude** as a bounded report count, clone coordinates per report because `triggerMouseEvent` increments them, and retain per-terminal fractional residue. Cap reports per event at one page; preserve ordering and no double emission. Prefer a released upstream fix; otherwise a checked-in Bun dependency patch must include the distributable consumed by Vite, not only TypeScript source. Future patch ownership: root `package.json` patchedDependencies, `bun.lock`, and `patches/@xterm%2Fxterm@6.0.0.patch`; no dependency change was made here.
4. Small **pixel** application events remain the hardware-dependent decision. Compare upstream's proposed per-event bypass against distance accumulation in an isolated harness. Recommended candidate for evaluation is CSS-pixel / measured-cell accumulation with no 50 px classifier, no per-event minimum, signed residue, and bounded magnitude emission. This removes the artificial threshold discontinuity, but changes existing application-trackpad speed; do not ship until the trackpad matrix passes. Calibrate a separate application pixel gain from real traces, not a guessed mouse/trackpad label. If the candidate fails, retain upstream pixel behavior and record this branch unresolved; do not mask it by inflating global sensitivity.

The line/page fixes are implementation-ready independently. Universal automatic improvement for pixel-emitting mice while guaranteeing identical pixel-emitting trackpad behavior cannot be promised from this report alone: there is no reliable standard device discriminator. Hardware acceptance is a required completion gate, not an optional polish step.

### 5. Preferences and defaults

Initial defaults: scrollSensitivity 1, fastScrollSensitivity 5 with Alt, smooth duration 0, no OS direction override, no new global preference. Users should not need to find a setting to fix missing bytes or incorrect page units.

If hardware establishes that normal-mode pixel distance is consistently too low, evaluate `scrollSensitivity: 2` and `3` against baseline in a disposable harness. It scales both devices and application thresholds; do not call it a mouse-only setting. If users need control, add an explicitly labelled **Terminal scroll speed** (0.5–4, default 1, Reset) scoped to terminal scrollback, with the existing settings tRPC persistence pattern and a dedicated `terminal-settings` store. Keep application scrolling a separately labelled preference if introduced. No schema migration is needed for a key in the existing appSettings table. Apply changes to existing terminals, clear residues, and avoid recreating PTYs.

Do not ship an automatic physical-wheel detector. An explicit mouse/discrete preset could provide a minimum per notch for low-delta pixel mice, but would also boost trackpads while selected; it is an optional fallback with a clear trade-off, not the recommended default. OS wheel speed and natural-scroll settings remain user-controlled.

## Tests to add during implementation

| Test owner | Required behavioral coverage |
| --- | --- |
| New `tests/terminal-wheel.test.ts` | LINE ±1/±3/fractional; PAGE ±1 with rows 1/24/60; invalid/NaN/Infinity/zero; cap after multiplier; Alt once; sign symmetry; small residue retained; direction reversal; boundaries; buffer/unit changes; pixel passthrough preserves the exact event. |
| New `tests/terminal-wheel-integration.test.ts` | Real xterm 6 DOM event propagation in Chromium: no double scroll; wrapper capture precedes nested listener; preventDefault exactly on owned events; padding/scrollbar behavior; normal-empty vs alternate; no local movement in tracking modes; correct CSI/SS3 counts; focus stays unchanged; overlays and hidden tabs do not affect underlying terminals; disposal/remount has one listener. |
| New `tests/terminal-input-routing.test.ts` | onData and onBinary remain distinct; replay suppresses both; binary bypasses CmdBuffer/Shift+Enter; encoding 1006 alone versus tracking+1006; DEFAULT, SGR, SGR pixels; X10 no wheel. |
| Existing `tests/daemon/daemon-client.test.ts` | Binary/text ordering, framing, disconnection, backpressure, protocol upgrade/capability handling. Use socket mocks; avoid starting the production daemon. |
| Existing daemon socket/PTY tests | Exact bytes including 0x80–0xff, bounded base64 rejection, UTF-8 keyboard input unchanged. Use fake PTY/writable sinks for byte checks. |
| Existing `tests/terminal-modes.test.ts` | Keep recovery coverage; add behavioral replay/attach cases through a mocked terminal, proving live TUI modes survive and stale-shell modes clear. |
| Dependency regression tests if patched | Quantities rather than Boolean acceptance, coordinate cloning, line/page count caps, modifier semantics, fractional direction changes, missing dimensions, high-frequency pixel gestures. |

Use existing Bun runner for pure/mocked tests. There is no established browser-wheel runner in this checkout; the real Chromium test can start as a disposable QA harness during the implementation task, with any new automation dependency reviewed separately. Happy DOM cannot validate real xterm geometry, native wheel conversion, canvas, GPU, or Chromium default actions. Do not claim its success proves hardware behavior.

Keep `terminal-paste`, `terminal-links`, `terminal-injection`, and `terminal-exit-message` regressions. Run appropriate package type checks after implementation, with pre-existing review-drawer active-prop failures recorded separately. Avoid the known flaky full suite unless broader changes warrant it.

## Manual hardware and application matrix

Every cell is pending hardware validation. Baseline and candidate must use the same device/OS settings and app version; record exceptions.

| Platform/device | Variations | Required observations |
| --- | --- | --- |
| macOS Apple trackpad | Slow drag, rapid drag, inertial tail; natural scrolling on/off | Signed distance, cadence, cancellation, no newly introduced minimum-step jumps. |
| macOS physical detented mouse | Basic USB/Bluetooth; 1/5/10 isolated notches; slow/fast rotation | Per-notch visible motion, emitted units and legacy values; compare shell and TUI. |
| macOS high-resolution/free-spin mouse | Ratchet and free-spin, vendor driver if already installed | No misclassification, flood, runaway acceleration, or accumulated jump after stopping. |
| macOS display configuration | DPR 1/2, external display change, 80/100/125% app zoom, WebGL/DOM fallback | Equivalent logical distance; no double-DPR correction; stable fit/cell measurement. |
| Windows renderer harness | Standard wheel, precision touchpad; OS one/three-lines and page setting; 100/150/200% scaling | Capture actual DOM units; do not assume Windows reports LINE/PAGE. End-to-end PTY only if supported in a separate Windows setup. |
| Linux renderer / available app | X11/Wayland, detented mouse/touchpad, fractional scale | Same unit rules, Shift axis behavior, middle-click selection unaffected. |

For each primary macOS device exercise: shell with 5,000 numbered lines; normal empty buffer; alternate-screen pager/editor with mouse off; same with 1000+1006; 1002/1003; legacy 1000 with 1006 off; X10; encoding-only 1006; a typical agent TUI; and tmux mouse off/on. Test focused/unfocused visible panes, inactive tabs, selection, top/bottom boundaries, split panes, contextual overlays, resize, and restored sessions. Populate only a disposable test terminal, never the user's active work session.

For application tests use a disposable raw-mode byte sink that can set/restore modes and report received bytes, plus real vim/less/tmux when already available. Restore modes in a finally block. Geometry, mode, expected ownership, bytes, and viewport movement must be recorded together; a TUI's choice of how many lines one report scrolls is application-defined.

## Accessibility, performance, and acceptance

- Preserve keyboard navigation, scrollbar dragging, text selection/copy, focus position, and terminal input shortcuts. Wheel must not steal focus. Ctrl/Meta gestures remain outside the normalizer; Shift behavior stays deliberate, not reinterpreted as acceleration.
- Keep smooth duration zero; respect reduced-motion if a later animation preference is added. Screen-reader mode currently defaults off; do not alter that as an incidental speed change. Validate with screen-reader mode enabled and keyboard-only navigation before release.
- No per-event React setState, IPC for local scrollback, allocations proportional to history, layout measurement, console logging, or timers. Pure normalization is O(1); application repeats are bounded. Target p95 handler work below 1 ms on the supported Mac, with no new long task ≥50 ms during rapid scrolling.
- A normal LINE delta of 3 moves three rows (subject to boundary); PAGE delta of 1 moves rows−1; Alt gain is applied once and capped. No event causes both local movement and a PTY report.
- Pixel scrollback events follow baseline unchanged by the default normalizer. Before release, measured trackpad distance must remain within 5% or one row of baseline, and momentum/direction must feel unchanged.
- Legacy reports reach the PTY byte-for-byte, SGR reports remain correctly encoded, and replay emits neither. Never lose high-bit coordinates to UTF-8 conversion.
- Line/page application inputs preserve bounded magnitude. Pixel application changes require a separately accepted trackpad comparison; no claim of “fixed for all mice” while the reporter's mode/device is unverified.
- Real affected mouse passes ten slow isolated notches and a fast sweep in its reported context without unexplained loss. Record expected/actual row or report counts; no catch-up after stopping or buffer switch.
- A normal empty terminal does not synthesize shell history/navigation. Alternate-screen apps retain ownership; switching back restores scrollback position. No inactive terminal or obscured pane reacts.
- Supported platform hardware results, exact runtime versions, and the reporter's mode accompany signoff. All pending matrix cells are marked untested rather than inferred as passed.

## Alternatives and rollback risks

| Approach | Benefit | Trade-off / decision |
| --- | --- | --- |
| Options only (sensitivity 2 or 3) | Smallest change; xterm owns all input | Speeds trackpads too, cannot recover onBinary or lift one-report cap, cannot correctly interpret page units. Use only after measured normal-pixel diagnosis. |
| Local line/page normalizer | Deterministic units; preserves default pixel path; source-only change | Does not fix pixel-emitting mice by itself; changes xterm's 50-px-per-line convention to terminal rows. Test OS settings and modifier behavior. Recommended bounded scrollback fix. |
| Public custom wheel hook only | Useful for passive alternate-screen navigation | Too late for consumed descendant viewport events; not a general scrollback fix. |
| Upstream fix/version-pinned patch | Correct application encoding/count ownership; avoids private app APIs | Dependency/addon compatibility burden; open PR is not a release; trackpad calibration needed. Isolate and pin. |
| Explicit discrete-mouse preset | Can improve small pixel notches without unreliable detection | Also affects a trackpad while selected; poor automatic multi-device UX. Optional fallback only. |
| Replace render engine / shrink lineHeight / increase scrollback | None tied to confirmed input failures | Broad churn or unrelated changes; reject. |
| Browser/window-wide wheel interception or synthetic redispatch | Superficially central | Breaks editors, modals, zoom, selection, and TUI ownership; double transforms and listener-order hazards. Reject. |

Keep binary bridge, scrollback normalizer, and application normalization separable. Removing the local adapter restores upstream scrolling without data migration. Revert any dependency patch and sensitivity preference independently. Protocol 3 rollback is not just a renderer revert: old app/new daemon mismatch can terminate sessions; require a tested forward/backward rollout plan. Do not repurpose normal text encoding, auto-reset live TUI modes, or preserve queued wheel residue across rollback/remount.

Known remaining uncertainty: a physical mouse in a normal pixel-mode shell may simply have low native deltas; no automatic device-safe gain is established here. The plan intentionally requires hardware evidence before selecting that behavior, while giving concrete fixes for the independently confirmed paths.

## Re-running the core arithmetic without writing files

This reduced in-memory diagnostic reproduces the application acceptance gate from the exact tagged method. It does not launch an app or touch a PTY. The investigation also ran the viewport and encoder methods as described in the results above.

```sh
bun run - <<'JS'
const url = 'https://raw.githubusercontent.com/xtermjs/xterm.js/6.0.0/src/common/services/CoreMouseService.ts';
const response = await fetch(url);
if (!response.ok) throw Error(String(response.status));
const source = await response.text();
const start = source.indexOf('  public consumeWheelEvent(');
const end = source.indexOf('  /**\n   * Triggers a mouse event', start);
if (start < 0 || end < start) throw Error('Unexpected upstream source shape');
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  'class Probe {' + source.slice(start, end) + '}');
const Probe = new Function('WheelEvent', code + '; return Probe;')(
  { DOM_DELTA_PIXEL: 0, DOM_DELTA_PAGE: 2 });
for (const [mode, dy, count] of [[0, 4, 10], [0, 20, 10], [0, 49, 1],
    [0, 50, 1], [0, 100, 10], [1, 3, 10], [2, 1, 1]]) {
  const p = new Probe();
  p._wheelPartialScroll = 0;
  p._bufferService = { rows: 24 };
  p._optionsService = { rawOptions: { scrollSensitivity: 1, fastScrollSensitivity: 5 } };
  let accepted = 0, sum = 0;
  for (let i = 0; i < count; i++) {
    const amount = p.consumeWheelEvent({ deltaY: dy, deltaMode: mode,
      shiftKey: false, altKey: false, ctrlKey: false }, 32, 2);
    sum += amount;
    accepted += Number(amount !== 0);
  }
  console.log({ mode, dy, count, accepted, sum });
}
JS
```
