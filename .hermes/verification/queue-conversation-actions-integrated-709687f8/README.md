# Lane C final integrated retest — 709687f8

**PASS for the requested UI/navigation/question/group scope. No actionable failures found; no production edits.** Codex ran this retest after integration, with no additional agents. Earlier lane artifacts are preserved separately.

## Exact source tested

Staging `integration/queue-remediation-2026-11-21` at `709687f8` was merged into the clean isolated C branch as `d7d54aa74abe26fa90d8533e047a59d6f2068a9d`. Equivalent conflicts in CLAUDE, workspace projection, control-plane server, ownership tests and MCP tests were resolved in favor of staging.

Before creating this report, **the entire merged Git tree was identical to staging**, both `5896736e61c2a407dcc4811dadeaf6813546f03f`. There were no additional local production or test modifications. This evidence commit adds only this report directory.

## Fresh results

| Check | Result | Evidence |
|---|---|---|
| Focused unit/model/SQLite/rendered UI | 94 passed, 0 failed, 481 assertions across 8 files | [focused.txt](focused.txt) |
| Desktop production build, from `apps/desktop` | Passed, exit 0 | [build.txt](build.txt) |
| Both native Electron fixtures, after that build | 2 passed, 0 failed, 15.06 seconds | [native.txt](native.txt), [native-result.json](native-result.json) |
| Key screenshots | Inspected; no actionable failure | Linked below |

Commands run from `apps/desktop`:

```sh
bun test tests/queue-model.test.ts tests/activity-queue-navigation.test.ts tests/queue-view.test.tsx tests/queue-question-reply.test.tsx tests/activity-queue-ownership.test.ts tests/describe-workspace-item.test.ts tests/activity-queue-workspace.test.ts tests/queue-later-options.test.ts
bun run build
SS_KEEP_QUEUE_FIXTURE=1 bun test tests/activity-queue-electron.test.ts tests/workspace-queue-electron.test.ts
```

## Requested behavior verification

| Behavior | Verified boundary |
|---|---|
| Exact reporter, including selected sibling | Native production projection/navigation selects `terminal-w2`, preserves pending count and attach-only intent, and creates no extra PTY. Model tests additionally cover dead siblings, closure and conversation replacement during inventory. |
| Exact coordinator | Native navigation opens `xro-native` / `coordinator-chat`, using its own directory; linked folder/repository scope remains context, not a substituted destination. |
| Saved versus retrieved | Native stale submission is rejected with draft intact. Saved answer remains pending and readable after leaving/reopening Queue; Open does not consume it. Sibling and unidentified inbox reads cannot retrieve it. Exact reporter trusted in-process read returns the correlated answer and removes question attention. |
| Blocked during save | Rendered UI test holds the answer promise pending, attempts Done and Open, and proves neither action runs; rejection retains the draft. This specific concurrency check is unit/rendered UI coverage, not a native timing assertion. |
| Unknown permission outcome | Native PermissionRequest → Stop remains unresolved with outcome `unconfirmed` and unchanged revision. UI says outcome unknown, asks review rather than renewed approval, and does not claim execution. |
| Grouped receipts | Native canonical report+turn row carries both receipts through Done/Undo/Later/Bring back. Focused UI tests assert exact member arrays; backend tests exercise stale/group conflicts. |
| Focus and layout | Native keyboard/focus containment, Escape return, next-row handling and four viewport geometries pass. Focused UI checks removal from narrow Details exposes/focuses the next row. |

## Visual inspection

Inspected these fresh screenshots:

- [Saved answer](queue-question-saved.png): actual answer and exact recipient are visible; status explicitly says not yet read and not resumed.
- [Coordinator context](queue-coordinator-context.png): own coordinator directory, role/chat title and separately labelled linked folder/repository.
- [Unknown permission outcome](queue-permission-unconfirmed.png): retained request with outcome unknown; no success claim or instruction to approve again.
- [Grouped report/reply](queue-report-context.png): one canonical row; report and provider reply remain distinguishable; combined action meaning is visible.
- [Stale question](queue-question-conflict.png): draft remains populated and Send is disabled pending explicit review.
- [Short scrolled actions](queue-short-scrolled.png): reply and queue actions remain reachable through local scrolling.

Additional geometry evidence: [800×600](queue-800x600.png), [1440×900](queue-1440x900.png), [narrow Details](queue-narrow-details.png). Automated geometry checks also cover 2304×1296 and 1200×500. Screenshots contain synthetic fixture data only.

## Boundaries and constraints

Native fixtures use isolated SQLite/profile/socket/PTYs, production preload/tRPC and shell components. The full-shell chat surface and lifecycle providers are stand-ins. No new live-provider execution was performed by C during this retest; the original investigator independently covers the full provider/entity matrix. This pass is not an authenticated production-launch → shipped GUI claim, and does not remove the documented provider-metadata limitation on automatic positive permission correlation.

Compatible parent dependencies were temporarily linked, without lockfile changes, then removed. No installed/dev app was stopped, no shared DB policy was altered, and no global trust/approval settings were changed. No merge into the parent branch, push or release was performed. The normal commit hook reported the known missing graphify module; it was not installed or bypassed.

Imported staging verification logs contain whitespace-only diff-check warnings; these prior raw artifacts were preserved. Only trailing whitespace in this retest’s new build log was normalized. This retest introduced no source changes. Hashes and exact fixture paths are in [manifest.json](manifest.json).
