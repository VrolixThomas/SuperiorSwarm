# SUP-41 independent review fixes

Base: `32e9ceaf`, isolated branch `fix/queue-hooks-review`. No merge/push or user lockfile changes.

## Corrections

- **Project-only Open:** `setSidebarSegment` accepts an explicit `restoreWorkspace: false` option. Hook Open selects its project and clears the active workspace/right panel without restoring another project's persisted repository workspace. Ordinary segment switches retain restoration and history. URL Open preserves the current route. Opening does not acknowledge.
- **Done during Fix confirmation:** exact hook admission now rejects the acknowledged revision before showing confirmation and on its existing fresh check after confirmation. Root/config/trust/workspace checks remain intact. Confirming a dismissed occurrence cannot prepare a launch.
- **Managed-agent replacement:** an additional production-path regression reproduced that both Claude and Codex hook Fix demoted the existing managed workspace session; Claude also reused workspace `cliSessionId`. Hook Fix now prepares a distinct unmanaged terminal with a fresh Claude conversation ID and launch nonce, leaves existing managed/session records untouched, and preserves provider-native permissions. All configured CLI presets retain their existing invocation shape. The returned launch is not called started until the renderer creates that exact terminal and sends its quoted script once through the existing `openOwnedChat` helper. No broadcast delay is involved. Hook resolution still belongs to a later complete check or explicit Done.

## Verification

Both original independent review probes failed on the base, then passed after correction. Six additional production hook → `defaultSpawnFn` → `AgentSessionManager` cases failed before the launch change and pass afterward: Claude/Codex × repository/folder/repository orchestrator. They assert fresh conversation identity, exact root/nonce/native-policy script, retained prior managed target and workspace session ID, no broadcast, and unchanged queue receipt.

Final focused results: **142 tests pass** (36 backend/owned-chat, 3 Open, 97 navigation/store/history, 6 hook React UI). Renderer tests prove no script before terminal creation completes, one write, cancellation with no effects, and failed creation without write or success message. Desktop production build passes. Biome and diff whitespace checks pass. TypeScript still has global errors (main 60, renderer 81, tests 222); no changed-owned-path errors. This lane does not claim a repository-wide clean typecheck or a complete normalized baseline comparison. Optional Graphify rebuild failed because the module is not installed.

## Boundaries

Production launch regression tests use real SQL state, script preparation and manager registration, but do not execute real Claude/Codex processes. UI tests use controlled terminal creation/write responses. Root owns the separate combined native IPC/Open fixture and any actual-provider hook-launch smoke after integration. These tests must not be represented as real CLI end-to-end Fix execution. Existing core own-chat actual-provider continuation evidence remains separate.

The hook feature still scopes hooks to project roots, uses POSIX process groups, and has no cross-process scheduler lock. No live service writes, real user project hooks, user conversations or global trust/settings were changed.
