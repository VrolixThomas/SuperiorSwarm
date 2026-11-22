# Project hook queue verification (SUP-41)

## Behavior and scope

Project checks are disabled by default. Enable them under General settings, add
`.superiorswarm/queue.yml` to a registered project's root, and review/trust the
exact configuration. Trust binds its bytes and canonical working directory to
that project ID. Changed bytes or a changed root require another review.

```yaml
hooks:
  - id: tests
    title: Project checks
    every: 5m
    run: ./scripts/queue-checks.sh
```

Commands print complete JSON lines, for example:

```json
{"key":"integration-tests","title":"Integration checks failed","why":"Two checks need attention","severity":"warning","fixPrompt":"Investigate the failing integration checks."}
```

A key identifies one project/hook item. Identical output preserves Done/Later
receipts; changed actionable output creates a new revision. Project names and
configuration-only changes do not create revisions. A complete successful run
resolves absent keys. Failed, invalid, cancelled, timed-out and oversized runs
retain all prior results. A reviewed/trusted configuration that removes a hook
retires that hook's old items. Missing/unreadable/untrusted configurations never
silently clear items. Errors are generic, with no stderr in the queue.

The runner enforces a maximum 30-second deadline and 64 KiB combined output
budget; both streams are independently counted. It kills its owned POSIX process
group on timeout, cancellation and normal shell exit, including background
children. Trusted hook commands must not deliberately detach into other process
sessions; this is a command runner, not an OS sandbox. Windows execution is
explicitly unavailable in this slice.

Scheduling is project-level: repository, folder and orchestrator workspaces
associated with one project observe a single source. Nested workspaces and linked
worktrees do not execute another copy of their parent's hooks. Two separately
registered project IDs pointing to the same physical directory intentionally
retain separate identities and require separate trust. Runs for the same
canonical root cannot overlap inside one application process. Independent app
processes are not a cross-process scheduler/lock service.

Open validates the exact receipt without acknowledgment. Fix lets the user pick
an existing workspace in the hook's exact project root, uses the configured
default CLI, shows the supplied prompt through the existing dispatch confirmation,
and rechecks receipt/root/trust after confirmation. It preserves native agent
permissions and does not dismiss the hook. Nested/worktree/coordinator workspaces
with another working root are not silently selected or created; return to a
matching project-root workspace to launch the fix.

## Verification

- `bun test tests/activity-queue-hook-source.test.ts`: 14 tests, 58 assertions.
  Temp project roots and fixture commands only. Covers trust/config bounds,
  duplicate JSONL keys, partial output/nonzero failures, successful resolution,
  exact root/config changes, overlapping refreshes, revoke/cancellation,
  descendant cleanup, deadline/output limits, project identity/aggregation,
  exact confirmation races, initial source errors, and retained dismissal.
- `bun test tests/queue-hook-ui.test.tsx`: 3 tests, 10 assertions. React/happy-dom
  with mocked tRPC transport; verifies opt-in, displayed trust snapshot versus a
  newer poll result, exact Fix receipt/target and disabled stale Fix.
- Production desktop build passed with a temporary root-router mount matching
  the integration contract below. No new diagnostics appeared in hook-owned files
  in main, renderer or tests TypeScript checks; repository baseline errors remain.
- No real project hooks, provider calls, actual agent launches, user trust settings
  or user databases were used by these tests. Native Chromium/public-router
  integration is performed by the shared external queue lane after wiring.

## Integration contract

- Root router: mount `queueHooksRouter` from `trpc/routers/queue-hooks.ts` at
  `queueHooks`.
- Startup: call `initializeProjectHookQueue()` once; call its returned stop
  function on shutdown. The function schedules refresh; it does not bypass opt-in.
- Shared refresh: `refreshProjectHookQueue()` respects each hook's interval.
- Projection: `isProjectHookQueueItemCurrent`, `describeProjectHookQueueItem`, and
  `getProjectHookQueueErrors` from `activity-queue/hook-source.ts`.
- Unified hook actions: render `QueueHookActions` with `{item, refresh}`; bind F to
  its `data-queue-hook-fix` button, or focus `data-queue-hook-workspace` if a target
  must be selected. Scope DOM lookup to the active panel/peek.
- Open: call `queueHooks.open` with `{id,revision}`; use its validated optional URL
  or existing project navigation. No workspace/shell creation.
- Settings: `ProjectHookSettings` is mounted by `GeneralSettings` in this commit.
- No migration, dependency, lockfile, token or webhook changes.
