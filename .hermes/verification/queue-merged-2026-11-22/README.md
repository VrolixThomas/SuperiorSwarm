# Queue merge and combined QA

SUP-39–42 are merged into `activity-queue`. The branch fast-forwarded from `014e5e79` to reviewed integration `84edb72c`, then received the test-only combined coverage and two reviewed follow-up fixes. No differing local files were overwritten. The user lockfile remains exactly as before, SHA256 `c3b29706e35ce3b2abe14db228dcc11f8917d97a6ae4eaca5a0d8eb29dca10ad`.

## Combined QA results

Three separate Codex agents exercised the merged feature with isolated data:

- **Lifecycle:** 13 tests / 154 assertions combine five external source kinds with chat/workspace attention. Both providers × repo/folder/repository orchestrator/cross-repo coordinator, ticket Start→link→chat→feedback, mixed receipts, restart, account/daemon loss, hook Fix and managed siblings pass. [Evidence](../queue-combined-lifecycle-2026-11-22/README.md).
- **Publication/navigation:** 47 author tests cover actual source observation, SQLite, controller reservations, real renderer stores, and local Git snapshots. A separate reviewer passes 53 tests, including six extra adverse cases. [Evidence](../queue-combined-publication-2026-11-22/README.md), [independent review](independent-feedback-review.json).
- **Native mixed UI:** eight items simultaneously represent three chats, ticket intake/feedback, PR review/feedback and a hook. Counts, tabs, grouping, Later/BringBack, Done/Undo, all eight Open targets, native Cmd-J across chats, mixed Peek, narrow layout and exact receipt/PID isolation pass. [Evidence/screenshots](../combined-queue-native-2026-11-22/README.md).

## Findings fixed on the merged branch

1. **Owned-PR COMMENT was wrongly treated as all feedback completed.** `df7ed806` preserves truthful publication outcome while recording occurrence resolution separately. Unresolved owned feedback survives the next poll; a distinct follow-up remains possible and an identical duplicate remains blocked. Independent retest covers new revisions, explicit Done during a post, source-kind changes, reviewer completion and uncertain outcomes. Legacy receipts remain conservative; historical acknowledgments are not automatically rewritten.
2. **Queue dialog text used the browser's black foreground in dark theme.** `3d538e02` adds the explicit theme foreground. Native red→green validation confirms option text matches the actual theme, with no layout/action changes. Root reviewed the one-class production diff and inspected the fixed screenshot.

## Parent validation after integration

- Desktop production build passes after both fixes: [build](final-build.txt).
- 71 tests across eight isolated post-fix suites pass: [manifest](combined-postfix-tests.json).
- Parent's final mixed native run passes in 4.45s: [log](combined-native.txt).
- Biome has no errors in the follow-up source/tests; existing-style warnings remain. One test-only `delete` operation was replaced with `undefined` before JSON serialization to keep the legacy-receipt fixture lint clean; its 9 tests / 114 assertions were rerun successfully. [Biome](final-biome.txt), [retest](publication-retest.txt).
- `git diff --check` passes. The original 348-test pre-merge suite and independent review record remain in [final integration verification](../queue-external-review-2026-11-22/README.md). Global pre-existing TypeScript diagnostics were not claimed as clean.

## Boundaries

These combined tests use synthetic provider/external observations and fake remote mutations. The native mixed UI uses real preload/IPC, SQLite, daemon/socket/shell PTY inventory and production renderer state, with bounded synthetic review provisioning and destination identity surfaces. It does not mount every real destination or authenticate external services. Separate actual Claude/Codex launch/context evidence is retained in the native launch report. No live ticket/PR changes, hook commands, user conversation mutations, pushes or releases were performed for this QA.

Temporary agent dependency links were removed. Existing user app instances and global provider settings/trust were preserved. All reported findings in this combined exercise are resolved in the merged branch.
