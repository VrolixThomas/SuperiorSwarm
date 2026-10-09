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

The separate upstream application-wheel damping/single-report behavior remains
in xterm. It did not explain the inspected normal-buffer chat, whose mouse
tracking was off. See [xterm issue #6105](https://github.com/xtermjs/xterm.js/issues/6105).

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
