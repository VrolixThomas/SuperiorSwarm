# Agent reading path — implementation handoff

Implemented on `investigate/explainable-pr-review-flow`, replacing the existing PR review entry point by default. No preview preference is required. Work remains uncommitted in this worktree.

## Implementation

- T1–T5: shared contract, explicit fixtures, coverage/order/progress model, path source, persisted preferences, review store/keymap, and shared data/mutation hook.
- T6–T7: 44px top bar, provider-aware reviewer queue, 440px drawer, next/previous PR, and extracted existing workspace-opening flow.
- T8–T9: 288px rail (240–360 resize), nested tests/context, separate finding/thread counts, alphabetical unmapped list, folder-grouped mapped Files mode, and virtualization over 100 files.
- T10–T11: reusable single-instance Monaco diff, model-safe file switching, focus decorations, read-only context, definition navigation, 32px hints, and unified default (saved split preference still restores).
- T12–T14: inline findings/resolved threads/agent notes, 400px overlay panel, thread filters/outdated metadata, selected-line Ask/Comment, answer citations and anchored draft prefill.
- T15: default full-window workspace in App, existing submit/reply/resolve/review-agent/terminal flows, rail-order keyboard navigation, overlay escape handling, and changed-file-only explicit viewed actions.
- T16: focused tests, build, formatting, baseline type comparison, and browser fixture checks completed. Authenticated native provider operations were not exercised.

## Verification

- `bun test` across 18 focused files: **129 passed, 0 failed** (renderer wrappers also execute isolated cases).
- Additional asynchronous-context readiness regression passes in `review-workspace-step.test.tsx`.
- `bun run build`: passes.
- Biome check: all 77 changed TypeScript/TSX/CSS files pass.
- Renderer and test TypeScript diagnostics: no additions compared with starting branch; repository-wide type check still fails on existing diagnostics.
- `git diff --check`: passes.
- Browser fixture with actual React/Monaco at **1512×945**: inspected all nine screen categories and light context. Header **44px**, rail **288px**, panel **400px**, hint bar **32px**, drawer **440px**. No viewport horizontal overflow; source lines retain their own scroll.
- Ask answer → Add as comment: body and anchor prefilled; zero posting mutations. Opening/closing overlay leaves diff width **1224px** unchanged.
- Context editor focused → `t` opens Threads; zero viewed mutations. Files-mode initial selection survives asynchronous details loading.
- Independent Codex review found and prompted fixes for context shortcut handling, early context-ready notification, hidden Markdown source, custom thread selection wrappers, and invalid selected-line comment anchors.

Logs: `/tmp/agent-reading-path-validation/`. Temporary visual harness: `/tmp/agent-reading-path-visual/` (query `screen=start|mapping|reading|ask|findings|queue|files|context|threads`, optional `theme=light`). It uses isolated fixture RPC, never authenticated providers. Runtime dependency links were temporary and no packages/lockfiles were changed.

## Remaining boundaries

1. As specified, real path generation/MCP persistence, automatic mapping trigger, and Ask transport remain a backend follow-up. Live PRs show unavailable states; no PR number implicitly activates samples.
2. Existing auth RPC exposes display name/numeric ID, not a reliable reviewer login. The reusable Threads component supports `currentUser`; assembled live UI disables **Mine** with an explanatory tooltip until that identity is available.
3. Outdated/original-line metadata is handled when supplied; provider population was outside the allowed backend scope of this increment.
4. Definition context uses an already-running LSP server. No result is a silent no-op. Snapshot-model synchronization and reference search remain follow-ups.
5. Existing content RPC conflates missing and genuinely empty files; UI says “empty or unavailable”. Reads are still based on the existing PR/branch plumbing rather than the deferred immutable snapshot flow.
6. Views preserve the existing Overview and thread rendering where requested by the plan; source content in the visual fixture is current repository code, so illustrative mock diff text is not reproduced pixel-for-pixel.
7. Graphify rebuild was attempted but unavailable (`ModuleNotFoundError: graphify`). No graph data was changed.

## Self-review

Accuracy 4/5: behavioral/build/visual evidence is concrete, but live providers were not exercised. Completeness 4/5: frontend lanes are implemented; reliable Mine identity needs a small backend addition. Clarity 4/5: boundaries are explicit in UI and this handoff. Actionability 4/5: code and tests are local and buildable with existing dependencies; no branch integration was requested. Conciseness 4/5: UI is split into small components, although the feature necessarily spans many files. Overall 4.0/5. Next highest-value work is the real path/Ask adapter, reliable reviewer identity, and an authenticated native smoke test.
