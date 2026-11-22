# Combined queue native exercise

Base: merged `activity-queue` source at `84edb72c`. A single native Electron profile simultaneously contains **eight attention items**: repository Claude chat, folder Codex chat, project-orchestrator Codex chat, assigned ticket intake, own-ticket feedback, PR review request, own-PR feedback and project hook output.

The baseline native run passes in **5.44 seconds**. It exercises real QueueView, NavRail, queue navigation runtime, renderer stores, production preload/tRPC, SQLite and real daemon/socket/shell PTY inventory. Assertions cover combined badge and category counts (8 / 3 chats / 2 PRs / 2 tickets / 1 check), category filtering and project grouping; Later/BringBack; Done/Undo across chat/ticket/PR-feedback/hook kinds; actual Open buttons for all eight targets; native Cmd-J across the three chats; mixed-source Peek and requested-item jumps; narrow details/overflow; unchanged other-source receipts and unchanged daemon PIDs.

## Test boundaries

Provider lifecycle events and external observations are controlled synthetic input, not authenticated live CLI or ticket/PR polling. The PR review row is intentionally unavailable for approval evidence reads: invalid fake credentials must not enter native provider authentication. It still participates in counts and Open navigation. No network requests, external writes or project hook commands occur. Hook bytes/root trust are real, and controlled output enters the production reconciliation function directly.

The destination surface reports verified store identity rather than mounting real terminals, Tickets or review content. Renderer Open logic and actual daemon inventory are used; review workspace provisioning is a narrow synthetic router procedure returning the known fixture review destination. Exact terminal attach-only intent is asserted, with no terminal creation. Existing full-shell/provider native suites separately cover mounted terminals and real providers. This test does not claim an authenticated Cartesian matrix or cross-repository-coordinator coverage; the orchestrator is project-local.

Two initial fixture selector assumptions were corrected (DOM text concatenates label/count, Later options contain numbered key hints). A fake-auth capability query was disabled to keep this native UI test isolated. Main mixed-source interactions pass without a production behavior change.

## Confirmed visual finding

With production CSS and explicit `data-theme=dark`, Later dialog text is `rgb(0, 0, 0)` on `rgb(31, 31, 34)`; normal body text is `rgb(238, 238, 238)`. The browser dialog default is not overridden by the current QueueView class. Baseline screenshot/computed evidence is retained here. Parent approved a separate narrow foreground-class fix and native regression assertion; that follow-up will record red/green evidence.

Run from `apps/desktop` after building:

```sh
SS_KEEP_QUEUE_FIXTURE=1 bun test tests/combined-queue-electron.test.ts
```

The fixture owns the GUI while running and preserves its synthetic artifact directory. Source/type checks report no diagnostics in the new test files; repository-wide TypeScript still has its existing failures. No live app/global trust/user lockfile changed, and nothing was pushed.
