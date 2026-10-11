# Codex chat scrolling fix — 2026-10-09

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
Consequently, installing a new renderer alone cannot enable snapshots on an
already-running old daemon. The updated terminal service must also start.

History already discarded by the old daemon cannot be reconstructed from that
raw suffix. Resuming the Codex session once after upgrading can rebuild its
transcript from Codex's own saved session data. No live user chats were killed,
restarted, or submitted to during implementation.

Snapshots preserve terminal text state. The upstream SerializeAddon does not
serialize inline image payloads or OSC 8 hyperlink destinations; plain URLs
remain recognizable by the renderer's WebLinksAddon. This is a limitation of
restored snapshots, not live rendering. Headless history adds memory bounded by
terminal dimensions and the retained line count.

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
