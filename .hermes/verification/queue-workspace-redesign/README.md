# Workspace-only queue redesign

Integrated locally on activity-queue, 2026-11-21. This is the first UI slice from docs/superpowers/plans/2026-11-18-queue-redesign.md.

Included: 72px navigation rail with Queue first and Settings last; dedicated queue destination; 42px rows with project, subject, reason and age; selected key hints; 420px detail panel above 1100px; narrow action bar; All/Needs input/Ready filters; grouping; persistent Later and Bring back; exact-revision Done/Undo; source errors and unavailable inventory; selection retained when returning from a workspace. Existing Cmd1-4 and sidebar collapse behavior retained. The live app no longer mounts the former queue dock/footer/collapsed rail.

Only current workspace/chat sources enter this view, its badge and its counts. Existing generic source storage and other application pages remain for later integration. Replies and permission decisions continue in the chat; no PTY-injection action is exposed. External queue categories, jump/peek and expanded cross-repo-coordinator backend support remain later slices.

Validation: 217 focused tests passed across 19 files, plus workspace-queue-electron and the existing activity-queue-electron native regressions (both pass). Native tests exercise production query/mutation/SQLite/IPC and real Chromium/PTYs in isolated fixtures. They verify external-source exclusion, Open without acknowledgement, Done/Undo, Later/Bring back, stale conflicts, repeated keyboard focus, loading, partial inventory, error recovery and empty states. The existing native lifecycle test retains both provider-shaped hook checks; it is not authenticated provider coverage.

Desktop build passed; Biome checks clean; type diagnostics match the unchanged baseline (61 main, 0 preload, 81 renderer, 203 tests). Graphify rebuild attempted but Python module is missing. User bun.lock modification preserved.

Code review found and fixed post-removal focus loss, wrong pending-filter counts on Later, mismatched Undo toast receipts, and concurrent Done/Later acceptance. Backend spec review and final scoped quality re-review passed.

Screenshots and evidence.json record the visually inspected 800x600 and1440x900 layouts. The bundled frontend evidence checker passed. Screenshots contain synthetic fixture content only.
