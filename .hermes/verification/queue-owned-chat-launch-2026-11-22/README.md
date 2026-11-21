# App-owned personal chat launch

The pane tab bar now offers **New Claude chat** and **New Codex chat** beside the existing bare-terminal plus button. It is available in repository, folder and coordinator panes. Editable Quick Actions remain ordinary shell commands; their text is never parsed to infer a trusted provider launch.

The local `agentLaunch.startChat` API accepts only workspace/entity identity and a provider enum. Main resolves the current entity and canonical directory, rejects missing/unsupported roots, creates a distinct terminal and records its known launch descriptor and per-command nonce. Ordinary chats use the provider's configured native permissions; review-specific bypass preferences are not applied. Their `managed:false` ownership does not demote or replace an orchestrator's managed dispatch target.

The known launch script uses `exec`, so the foreground group leader becomes the provider, and has no fabricated initial prompt. The renderer adds the exact prepared terminal, awaits terminal creation, then sends the shared quoted script command with one tracked Enter. It does not depend on the old 300ms mounting timer. Initial descriptor admission still waits for an authentic matching launch callback; creating a tab alone does not grant resume capability.

## Verification

- **18 tests / 155 assertions** cover both providers across worktree, folder, repository orchestrator and cross-repository coordinator; exact cwd/title/native policy and nonce; managed-target preservation; mismatched startup callbacks; missing roots; strict public input; failed-registration cleanup; menu keyboard/failure/double-click behavior; and create-before-write ordering.
- The concurrent-create test uses real terminal IPC, `DaemonClient` and `SocketServer` with a process stand-in. Simultaneous component mount and explicit creation invoke creation once, preserve callback environment, and retain one output listener. It is not a native provider process claim.
- **58 existing dispatch/session regressions / 227 assertions** pass.
- **Native full-shell UI** passes in 35.44 seconds. Workspace at 1440px and coordinator/folder at 800px expose both choices, remain in viewport and hit-testable, support Down/Escape with focus return, and create no terminal/agent rows or PTY writes merely by opening the menu. Existing queue navigation, receipt, save-only and zero-replacement checks remain enabled. Provider state is a stand-in; no actual provider is launched by this read-only visual test.
- Production build passes. Main and renderer retain the existing 61/81 diagnostics; changed owned paths are clean. Tests also have existing global diagnostics; owned test paths are clean. See [types](types.json).
- Final images were inspected: [workspace](workspace-menu.png), [coordinator](coordinator-menu.png), [folder](folder-menu.png). The first semantic pass captured stale pre-menu compositor frames; explicit fixture activation and a double-animation-frame/paint wait corrected the evidence without changing product code or weakening assertions.
- The first native setup attempt failed before UI because this isolated worktree had no authentication environment. The fixture now builds its unused auth import with an inert localhost endpoint and synthetic key, so native UI testing does not require user credentials. Production auth configuration is unchanged.

## Integration

Owned implementation commit: `c274254b`. This lane's fixture/evidence and index commits are reported separately in the handoff.

Dependencies, not owned changes:

- backend `c3794824` → local `1a59c2d3`
- backend `438a0d45` → local `168d5679`
- parent shared script formatter `05e008d9` → local `7a1a5e88`
- answer-lane save-only fixture selector `dafe8734` → local `56232253`

Run from `apps/desktop`:

```sh
bun test tests/owned-chat-launch.test.ts tests/owned-chat-ui.test.tsx tests/owned-chat-terminal-create.test.ts
bun run build
SS_KEEP_QUEUE_FIXTURE=1 bun test tests/queue-jump-electron.test.ts
```

The last command requires the exclusive native GUI slot. Actual provider resume/answer probes and final integrated release gates belong to the parent/backend lanes. No user chat, global policy, app instance, or lockfile was modified by this lane; no push/release was performed.
