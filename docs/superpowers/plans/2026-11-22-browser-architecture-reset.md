# Built-in browser: architecture reset

Date: 2026-11-22. Scope: replace SuperiorSwarm's browser presentation layer and validate it in the full application. The design is followed by the execution record below. Previous uncommitted work was preserved.

## Decision

Replace the current main-process WebContentsView presentation layer with a persistent, renderer-hosted Electron `<webview>` architecture. Separate the persistent guest registry, pane placeholders and overlay containers. Keep guest host ordering stable and rendering lifecycle explicit.

The following design records the migration plan; implementation and verification results appear in the execution record. A change of embedding primitive does not by itself fix DNS, website compatibility, or every rendering failure. The first replacement slice must pass acceptance in the actual SuperiorSwarm window before agent features are expanded.

The earlier isolated fixture and individual successful page loads were insufficient to conclude that the user's application worked. That acceptance standard must change.

## What is wrong with our current foundation

The native embedding API itself is not inherently incapable. The architectural mismatch is the amount of custom integration required for a heavily composited React pane application:

- `main/browser/electron-page.ts` creates native child views above the renderer. React controls cannot simply use their ordinary stacking order to appear above them.
- `renderer/browser/lifecycle.ts` compensates by scanning `.fixed`, dialogs and menus, performing overlap/hit tests, and hiding the entire guest. Every unrelated UI control can affect whether the browser is displayed. The right-edge button incident demonstrated this coupling.
- Native display rectangles, React pane state, asynchronous polling and agent observations have separate lifetimes. The current approach needs repeated corrective synchronization to keep them aligned.
- We keep native pages alive in main, but lack a distinct persistent DOM guest host, per-browser overlay layer and frame/capture lifecycle.
- Ephemeral random workspace partitions and blanket popup restrictions provide limited preview functionality and prevent durable website sign-ins.
- Fixture success does not demonstrate correct operation in the user's full window, with the actual terminal panes, sidebar, diff panel, dialogs, running build and lifecycle transitions.

The existing workspace authorization, typed command contracts, agent takeover epochs, URL checks and error classifications remain useful. They do not require keeping the current presentation layer.

## Replacement design for SuperiorSwarm

### Renderer

Create one `WorkspaceBrowserHost` for the authenticated app lifetime, containing a stable `BrowserRuntimeRegistry`. A browser tab renders only its toolbar and a `BrowserSurfaceSlot` placeholder.

A registry entry owns:

- Stable browser ID and workspace ID.
- One webview node which is never reparented or reordered during tab/pane movement.
- The current placeholder and a matching overlay container.
- Guest webContents ID plus attachment generation.
- Navigation state from actual guest events, rather than a continuous metadata polling loop.
- Display/parking/capture state and cached viewport size.

Tab switches update the placeholder/active presentation. Actual tab closure destroys the guest. Error pages, find UI and browser-specific overlays use the registry overlay; global dialogs stay in a deliberate higher application layer. Remove the global `.fixed`/`elementFromPoint` browser-hiding heuristic and its permanent-edge exception.

### Main process

Enable webviews only in the trusted app window and gate attachment. Main allocates approved partitions, validates guest type/host/partition/ownership and binds the guest to an existing browser reservation. Reject stale registration generations.

Retain sandboxing, disabled Node integration, context isolation, normal web security and a separate guest session.

Adapt the browser service to registered webContents instead of creating/positioning WebContentsViews. Keep privileged navigation/session operations, workspace authorization and agent controls in main. Retain the existing authenticated MCP/control-plane entry point; a second global debugging port is unnecessary.

### Profiles and popups

Use stable, explicit browser profile identities with separate app and website sessions. Use a separate persistent partition for each workspace. Persistent workspace profiles and an explicit clear-data control can provide durable sign-ins.

Distinguish ordinary links, popup sign-in flows and unsupported protocols. Real auth popups need the same session and opener relationship, with managed lifetime and navigation restrictions. Validate real supported login flows rather than promising that every identity provider accepts an embedded browser. Do not copy user-agent rewrites as a universal compatibility fix.

### Automation

Operate the registered guest the user sees. Initially preserve the current visible-tab and pause/takeover rules. Add a single owned debugger/CDP attachment where required, shared through typed operations. If background automation is later enabled, introduce explicit ref-counted rendering/wake leases rather than silently acting on an unpaintable hidden tab.

Captures need bounded waits, cancellation and actual frame readiness. Store/UI state saying “visible” or a URL/title event is not enough.

## Migration sequence

1. **Establish runtime identity.** Record the actual launched worktree, loaded main/renderer build and Electron version so acceptance cannot accidentally inspect a different running app.
2. **Manual browser vertical slice.** Introduce root host, secure guest registration and one workspace browser tab. Implement address/history/reload and ordinary page input. Do this in the actual app shell with existing sidebars and terminal tabs.
3. **Lifecycle and stacking.** Add stable tab movement, workspace switching, clipping, overlay portals, focus/keyboard forwarding and intentional close/crash recovery. Remove the old presentation coordinator from the new path.
4. **Profiles and website behavior.** Add stable profile handling, new-tab links and real sign-in popup lifecycle.
5. **Agent adapter.** Reconnect the scoped tools to the registered guest, validate pause/cancellation, and add frame-aware captures. Agent controls follow a working human browser, rather than serving as a proxy for validating it.
6. **Retire the old path.** Keep rollback possible during the first slices; remove the obsolete native-view presenter only after actual-app acceptance passes.

Code mapping:

| Current area | Replacement |
| --- | --- |
| `main/browser/electron-page.ts` native creation and setBounds | Registered guest adapter + main attachment/session policy |
| `renderer/browser/lifecycle.ts` document-wide overlap scan | Persistent registry + surface slot + explicit overlay layers |
| `renderer/browser/BrowserTab.tsx` | Toolbar and slot subscribing to authoritative guest events |
| `main/browser/service.ts` | Keep ownership/queue/takeover; add reservation/registration generations |
| `main/index.ts`, preload, browser router | Host webview attachment guard and narrow registration/events bridge |
| Browser fixture | Retain unit/contract coverage, add real-app end-to-end acceptance |

## Acceptance gate

Do not declare the browser working until the **actual SuperiorSwarm development window** passes:

- Public HTTPS and an active localhost dev server; typing, clicking, scrolling and navigation visibly work.
- Multiple inactive terminal tabs plus browser tabs, both open and collapsed side panels, command palette, menus, dialogs and toasts.
- Tab switching, pane splitting/reordering and workspace changes preserve guest identity, form input and scroll.
- Window resize, zoom, maximize, background/foreground and suspend/resume do not leave a blank or unclickable surface.
- Dynamic pages/animations paint; screenshots show the actual settled page, including after lifecycle transitions.
- Error→corrected URL and error→Retry produce the intended page and remove stale errors. Invalid DNS remains an explicit negative case, not an explanation for every reported failure.
- Popup callbacks preserve opener/session where supported; closing popups and tabs cleans up correctly.
- Agent observations/input/captures address that same guest and cannot cross workspace boundaries or survive user takeover.

Mocked guests and renderer bridges are useful regression checks, but they do not replace full-application acceptance.

## Tradeoff and version boundary

Electron explicitly discourages `<webview>` because its underlying architecture/API may change, and recommends alternatives including WebContentsView. [Electron web embedding guidance](https://www.electronjs.org/docs/latest/tutorial/web-embeds).

For our tab/split-pane product, the persistent DOM-hosted approach is nevertheless the better candidate to evaluate next because it avoids the native-child/React stacking mismatch. Pin the Electron version and own integration coverage for upgrades. The starting runtime was Electron 40.8.5. An upgrade must account for macOS rendering behavior, native PTY/SQLite builds and packaging.

## Scope of this result

This design defines the replacement architecture and acceptance criteria. The execution record below documents the implemented changes, verified behavior and remaining limitations.


## Execution record — Electron 45 and persistent webviews

Implemented after user approval to execute this plan and upgrade Electron.

### Runtime and native compatibility

- Electron pinned to **45.4.1**, the current stable release confirmed by the official releases list and npm registry.
- `@electron/rebuild` pinned to 4.2.1; ABI metadata pinned to node-abi 4.43.0.
- Upgraded desktop and standalone MCP SQLite to **better-sqlite3 13.2.0**. The prior 12.8.0 V8-based binding failed to compile against Electron 45; v13 uses N-API.
- Rebuild scripts read the installed Electron binary's actual ABI (150) and pass it to the rebuild API, rebuilding both SQLite and PTY. The standalone MCP copy is rebuilt for that same runtime. PTY helper executable modes are restored explicitly.
- Verified real SQLite queries, all application migrations, standalone MCP SQLite, and PTY subprocess creation inside Electron 45.4.1. Verified SQLite/MCP/PTY again from the packaged `.app`.

### Replaced architecture

- Removed `main/browser/electron-page.ts` and its WebContentsView creation/geometry layer.
- `BrowserGuestRuntime` now reserves persistent workspace profiles and registers renderer-created webview guests. It verifies reservation generation, guest type, owning app window, session identity and unique assignment.
- The app window gates `will-attach-webview`, forces sandbox/context isolation/no Node/no inherited app preload, and accepts only allocated partitions with an initial blank page.
- `BrowserRuntimeRegistry` owns permanent body-level guest nodes and overlay containers. Pane components attach slots; moving or remounting a pane does not move or recreate its webview.
- Geometry and ancestor clipping are DOM/CSS based. The global `.fixed` overlap scan, elementFromPoint visibility heuristic, and right-edge reservation exception are gone. Declared modal/menu markers suspend agent operations without hiding the page underneath the UI.
- Navigation/title/loading/error updates are event-driven; the old browser-state polling loop is gone.
- Persistent profiles are separate per workspace, separate from application authentication. A clear-data action removes website cookies/storage/cache.
- Ordinary links create tabs; sign-in popups preserve their opener/session and support callbacks and close. Nested windows are bounded and navigation remains guarded. Real third-party provider sign-ins were not exercised with user credentials.
- Agent operations use the registered guest with the existing workspace/takeover guards. Screenshots await frames. Crashed guests can be replaced under a new registration generation while preserving paused-agent state.
- Fixed the existing split-size callback to read react-resizable-panels' keyed layout object, so resized pane ratios can persist.

### Validation

- Core native suite on Electron 45.4.1: real local HTTP/WebSocket pages, actual registered guests, typing/clicks, stable identity across switching/remounts, desktop/phone layout, modal layering, shortcuts, drag passthrough, ownership checks, real popup/opener/callback, network failure/retry, crash recovery, and screenshot capture.
- A second Electron process verifies saved workspace storage survives restart; the clear-data control removes it.
- Full-App acceptance renders the actual `App`, sidebar, terminal tabs, pane containers, split layout, side panel, dialogs and command palette. Account/project responses and terminal transport are isolated fixture data. Browser host, preload/IPC, guest runtime and website traffic are real production code. No user account or coding agents are used.
- Visually inspected the full-App window on Electron 45.4.1 with a terminal pane and the live SuperiorSwarm website beside it. The browser remains visible with the side panel and normal app controls.
- 174 focused/regression tests passed across 15 files, including terminal lifecycle/wheel tests and native bindings (432 assertions).
- Production build passed. macOS arm64 directory packaging passed with the repository's release builder version 26.16.1, signing disabled. Packaged Electron/SQLite/MCP/PTY smoke checks passed. No release was published or notarized.
- Main/preload/renderer/test type checks introduce no new diagnostics relative to the recorded baseline; the pane-size fix removes one existing renderer diagnostic. The full-App fixture is checked under the renderer TypeScript configuration, rather than the test configuration which has no renderer path aliases. Existing unrelated type-check failures remain.
- New browser/runtime/test files pass Biome. Existing CommandPalette accessibility/dependency lint errors remain outside this change; that component's addition is only its explicit modal marker.

### User controls

“Pause agent” controls agent access to that browser tab only. It does not stop a coding task in a terminal. “Clear data” clears this workspace's website cookies/storage/cache, potentially signing sites out; it does not delete project files. Persistent profiles and these controls can be moved into a browser menu in a subsequent UI polish pass.

Sources for the runtime upgrade: [Electron stable releases](https://releases.electronjs.org/release?channel=stable), [better-sqlite3 v13 migration to N-API](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0).


### Address-bar search follow-up

The reported `youtube` → `https://youtube/` failure came from treating every address-bar entry as a hostname. The guest itself was functioning.

Implemented a separate `resolveBrowserAddress` function with Google as the default search destination. Bare words, phrases, Unicode and `site:` queries search; domains, explicit URLs, host ports and loopback addresses navigate directly. Blank input is a no-op. Disallowed URL schemes and embedded credentials are rejected instead of forwarded to a search provider. Agent navigation retains its strict URL schema. No configurable engine selector, history suggestions or autocomplete service was added.

The toolbar now advertises search, selects its contents on focus, preserves an editing draft across page updates, restores the current URL with Escape/blur, and guards Enter during text composition.

Validation:
- 60 tests / 162 assertions passed across address parsing, browser service, load errors, control plane and persistence suites.
- Real Electron integration passed with actual address-field submission, navigation into the registered webview, direct domains, schemeless loopback, select-all, Escape, blank input and composition. External responses are deterministic fixtures in this automated regression.
- Full-App live check entered `youtube` through the actual toolbar and loaded Google search. Visually verified YouTube results after declining optional Google cookies in the isolated test profile.
- Production build passed; changed files pass Biome. Renderer type-check diagnostics remain at 62 versus the pre-feature baseline of 63, with no new diagnostics after normalizing checkout paths.
