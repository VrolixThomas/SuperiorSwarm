# Workspace browser implementation

Current implementation: superseded by the executed [persistent-webview/Electron 45 replacement plan](2026-11-22-browser-architecture-reset.md). The entries below record the earlier iterations and investigations.

User-approved direction: add an HTTPS/local HTTP browser to ordinary SuperiorSwarm workspace tabs. Human and agent operations use the same native page.

## Implementation sequence

- [x] Define browser contracts and URL/request policy, including localhost WebSockets for hot reload.
- [x] Add a main-process registry of sandboxed WebContentsViews keyed by workspace/tab. Implement navigation, history, desktop/phone sizing, observation, guarded actions, screenshots, and teardown.
- [x] Add trusted-renderer browser IPC and lifecycle integration. Keep website content isolated from the app preload and credentials.
- [x] Add browser tabs, address/navigation controls, split-pane support, tab metadata persistence, explicit terminal-link entry, and native overlay/drag hiding.
- [x] Extend authenticated workspace-agent MCP/control-plane operations with browser tools. Validate workspace ownership and serialize page operations. Keep explicit user takeover available.
- [x] Verify policy, lifecycle, stale observations, workspace isolation, and layout persistence with focused tests; exercise real Electron navigation, input preservation, responsive sizing, hot reload transport, screenshot capture, and cleanup. Run type checks and production build.

## Design decisions

- One native view per browser tab; moving or hiding a tab does not close its page.
- In-memory browsing profiles per workspace for this first implementation. Tab URL/title/viewport persist; login state does not survive app restart. Profiles are separate from the application's default session.
- HTTPS and loopback HTTP are supported. Request policy separately admits secure WebSockets and loopback WebSockets; privileged top-level schemes remain blocked.
- Native presentation is controlled by the trusted renderer, independently of queued page actions. A stale presentation cannot overtake a newer hide.
- Agent tools use the existing authenticated control plane. Workspace agents only access their own workspace; no global debugging port or arbitrary JavaScript tool.
- Agent mutations require a visible page and an enabled agent-control toggle. Observations carry document identity and sequence; stale element actions fail.
- Permission requests, downloads, popup windows, and external protocol launches are blocked. Ordinary HTTPS/local HTTP GET links targeting a new tab open in the source workspace and pane. Opener-dependent OAuth windows, POST popups, persistent profiles, frame/shadow-DOM automation, and full mobile-device emulation remain follow-up compatibility work.
- Desktop viewport fits the pane; phone mode previews a 390×844 CSS viewport. This is responsive preview, not a real-device emulator.

## Acceptance

Open a local app or HTTPS website in a browser tab; move it into a split; type into a form; switch tabs/workspaces and back without losing input. Dialogs, menus, and drag overlays remain usable. Back/forward/reload and phone/desktop sizing operate the same page. Workspace-scoped agent tools observe and manipulate that page and return useful errors for stale refs, hidden tabs, paused control, or foreign ownership. Closing tabs/panes/workspaces and closing the app retire native resources.

## Verification results

Implemented the browser service/native adapter, renderer tab and presentation coordinator, trusted tRPC boundary, existing control-plane integration, and nine workspace-agent MCP browser tools (list/open/observe/navigate/viewport/click/type/scroll/screenshot).

- 169 tests pass across browser policy/service/control-plane/persistence/native-Electron tests and existing terminal-link, pane, tab, session-persistence, and control-plane suites (423 assertions).
- The isolated Electron 40.8.5 integration test exercises the production React browser controls, preload, tRPC routing, native adapter and service against a real local HTTP/WebSocket server. Eighteen scenarios cover same-page observation/actions, workspace storage isolation, overlays/drag hiding, preserved input, responsive viewport/resize, pause/resume, history/reload, actual PNG capture, guest destruction, React remount preservation, command-palette shortcuts, and linked-tab session/control inheritance. The native suite also passes with React development/StrictMode enabled.
- Production Electron build passes. No additional application dependency was required.
- Targeted Biome checks pass and git diff has no whitespace errors.
- Full TypeScript checking is already failing at HEAD. A clean archived HEAD checkout with the same dependencies produces the same diagnostics: 52 unique main diagnostics, 63 renderer, 119 test-project diagnostics, and no preload diagnostics. The implementation adds none in the compared runs. Existing examples include PreviousCommentContext, SolveSessionStatus, and SQLite adapter types.

The native test uses an isolated test profile and fixture workspace identities. It does not claim a live provider-backed agent run, arbitrary external-site/OAuth compatibility, or signed distribution verification.

## Using the feature

- Click New browser tab beside the pane's new-terminal button, or run Open Browser Tab from the command palette.
- Enter HTTPS or a local address such as localhost:5173. Shift-click a terminal URL to request an in-app browser tab; ordinary links retain their external-browser behavior.
- Move/split the tab using existing pane controls. Desktop follows the pane; Phone previews a 390×844 viewport.
- Pause agent control in the toolbar to prevent agent observations, screenshots, navigation, and actions. The user can still browse manually.
- Cmd/Ctrl+L focuses the browser address; Cmd/Ctrl+W closes the browser tab while its page has focus; Cmd/Ctrl+R reloads it; Cmd/Ctrl+K opens the application command palette.
- Existing agent processes need to reconnect/restart their MCP connection to discover the new tools. Cross-repo/external-manager contexts do not receive browser tools; local workspace-agent contexts do.

Sign-ins live in an in-memory workspace profile shared by that workspace's browser tabs, cleared when the last tab closes or the app exits. Restored tabs retain their URL/title/viewport, not cookies or unsent form values across app restarts. Hidden/moved live tabs retain their page and form state.


## Continuation: browser integration polish

- [x] Reproduce and fix queued agent work surviving pause/resume, hide/show, and manual navigation. Revocation changes both the operation generation and observation sequence. Native key/mouse interaction also invalidates prior agent work. Already-issued website effects cannot be undone.
- [x] Preserve the same native page during a same-commit React coordinator remount/StrictMode replay; genuine unmount still releases pages after the handoff microtask.
- [x] Route ordinary new-tab GET links through the existing workspace browser service. Preserve the opener pane, background-tab disposition, workspace profile, viewport, and paused-agent state. Website-owned windows and opener bridges remain disabled.
- [x] Route Cmd/Ctrl+K from focused browser content to the app command palette and hide native content underneath it.
- [x] Extend native and regression checks for these behaviors. Four takeover tests first reproduced the old failures, then passed after the fixes.


## Blank-pane correction (2026-11-22)

The user's Google screenshot exposed a gap in the original acceptance fixture. The page had loaded, but the generic `.fixed` overlap check treated App's permanent right-edge **Open panel** button as a modal and hid the entire native view. The old fixture used replacement CSS and an inset host that never touched this control.

- Extracted the unchanged panel-opening UI into `OpenPanelButton`, shared by App and the native regression fixture.
- Marked its right-edge reservation explicitly. Browser measurement now reserves that strip while leaving the page visible; actual modal/menu overlays still hide the native view.
- Clipped the browser host to the visible window instead of rejecting the whole page when an edge falls outside the viewport.
- Replaced hand-written fixture styling with the compiled production stylesheet. The real-control fixture failed on the old presentation logic and passes with the fix. It verifies the control remains outside the native view, width is restored when the panel handle disappears, and viewport clipping preserves visibility.
- Visually inspected the actual native Electron window with Google loaded, including Google's consent page and the app toolbar/right-edge control. This was an on-screen inspection, not an inference from page title/DOM or a renderer-only screenshot.
- Optional live HTTPS check: run the native test with `BROWSER_SMOKE_URL=https://www.google.com/`; `BROWSER_SMOKE_HOLD_MS` can retain the isolated window briefly for manual inspection. The normal regression test uses a local HTTP/WebSocket fixture and does not need external websites.
- Native page screenshot and presentation receipt are in generated `apps/desktop/out/verification/workspace-browser-google.*`. The receipt records Google visible at native bounds x=30, y=73, width=854, height=565.

## Deep recovery review (2026-11-22)

Reviewed the address/load/failure/retry path and ran the native adapter under Electron 40.8.5 in an isolated process.

| Requested address | SuperiorSwarm result |
| --- | --- |
| `https://www.superiorswarm.com/` | `ERR_NAME_NOT_RESOLVED (-105)` |
| `https://superiorswarm.com/` | Website loaded, actual title and DOM |

System DNS separately reports NXDOMAIN for `www.superiorswarm.com`; the apex resolves to `216.198.79.1` and HTTPS returns 200. This is an address/DNS configuration issue, independent of Electron embedding. No DNS, proxy, TLS-validation, or website configuration was changed.

### State and click-path findings

- Native loading state previously cleared errors only on `did-start-loading`. An immediate failed→successful navigation can stay within the same loading interval, leaving the old failure banner above the newly loaded page. The native navigation probe reproduced this with the user's exact hostname. Explicit navigation and main-frame navigation events now own request identity; successful loads clear prior errors, and failures belong to the attempted URL.
- Renderer polling and command responses previously had no shared revision guard. An older poll could overwrite a newer navigation response. Pending manual commands now suppress polling publication, and command versions reject stale responses.
- Retry now reloads the actual failed URL, including when Chromium has retained an earlier document. A native regression creates a refused localhost connection, starts its server, clicks the real Retry control, and verifies the recovered URL, page title, and native visibility.
- Network failures now render an actionable application error page. DNS, offline, connection, timeout, certificate, and blocked-request failures have distinct explanations. DNS failures for a `www` hostname offer an explicit **Open <apex>** homepage action. This never auto-redirects or forwards paths/query tokens/fragments to another hostname.
- Failed native pages are hidden behind the app error UI and excluded from agent observations/screenshots. Agent navigation reports failed/loading/loaded state and can recover a visible failed tab.
- Back/Forward, Stop, viewport controls, pause/resume, tab movement, popup-tab handling, and external opening retain the existing control paths; the focused regression suite covers their interactions with native presentation and ownership.

Verified the exact UI flow with computer use: observed the DNS error for `https://www.superiorswarm.com/`, clicked **Open superiorswarm.com**, and observed the actual SuperiorSwarm website, title, navigation, hero content, and links inside the native browser. The previous failure UI disappeared. Evidence is in generated `apps/desktop/out/verification/workspace-browser-recovery*.json` and `superiorswarm-*.json`.

Validation: 169 tests / 423 assertions passed across 11 focused and regression files; production build and targeted Biome checks passed. Type-check diagnostics still match clean HEAD (52 main, 0 preload, 63 renderer, 119 test-project unique diagnostics), with none introduced.

Reference: [Chromium network error definitions](https://raw.githubusercontent.com/chromium/chromium/main/net/base/net_error_list.h).

### Scoped click-path state map

| Owner/action | Reads | Writes / resets |
| --- | --- | --- |
| Native `beginNavigation` / main-frame events | Requested URL, current request generation | Sets requested URL and generation; clears previous network error |
| Native failed/successful load | Failed URL, main-frame flag, current request | Sets matching failure or clears it on success; hides failed native content |
| `BrowserService.command` | Workspace/tab ownership, operation queue, control epoch | Invalidates older agent work for manual commands; runs the requested operation on the same page |
| `BrowserService.sync` | Renderer tab list and presentation rectangles | Closes removed tabs, hides inactive pages, preserves existing page state |
| Renderer `command` / `poll` / `publish` | Request version, pending commands, focused address input | Publishes only current results; updates URL/title/viewport metadata; preserves active address edits |
| Pane store tab movement | Source/target panes and tab identity | Moves metadata while retaining the main-owned browser; actual removal releases it |

| Touchpoint | Ordered path and final outcome |
| --- | --- |
| Address Enter | Normalize explicit address → manual command → native navigation → current result/poll → matching URL and page/error UI |
| Retry | Ensure page → reload actual failed URL → clear error on success → restore native content; tested against a server started after connection refusal |
| Open non-www homepage | Explicit user click → new validated HTTPS navigation; no automatic hostname substitution or token forwarding |
| Back / Forward / Reload / Stop | Shared command boundary → native history/loading methods → current state publication; tested on actual Chromium |
| Desktop / Phone | Update viewport metadata → native geometry/emulation → preserve document and input |
| Pause / Resume | Increment control epoch → change agent access → stale queued actions/references remain invalidated |
| External browser | User action → current allowed HTTP(S) URL → existing shell boundary |
| New-tab link | Validate GET tab request → same-workspace page → opener pane/background disposition → preserve control/profile isolation |
| Tab/pane close | Remove metadata → reconcile native registry → cancel pending operations and close owned contents |
| Open side panel / dialogs | Reserve permanent edge chrome or hide native view for overlays → preserve page and restore it after the transition |
