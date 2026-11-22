# External queue independent review follow-up

Integration base: `32e9ceaf`, plus completed SUP-45 verification from `014e5e79`. This integration branch is separate from the user's `activity-queue` branch. No external service posts are used by verification.

## Findings being corrected

| ID | Independent finding | Owner | Fix/retest evidence |
| --- | --- | --- | --- |
| T1 | Status-only changes resurrect dismissed ticket feedback | Ticket | c61040fa; independently approved (24 tests + two-process probe) |
| T2 | Edited pending comments keep obsolete text | Ticket | c61040fa; independently approved (24 tests + two-process probe) |
| T3 | Start accepts acknowledged occurrence | Ticket | c61040fa; independently approved (24 tests + two-process probe) |
| T4 | Concurrent Start requests create duplicate work | Ticket | c61040fa; independently approved (24 tests + two-process probe) |
| P1 | Successful approval can post twice after local cleanup failure | PR | 43960de7; independently approved (25 tests) |
| P2 | Solver cleanup deletes another provider/workspace session | PR | 43960de7; independently approved (25 tests) |
| P3 | Solver starts from stale comments after failed refresh | PR | 43960de7; independently approved (25 tests) |
| P4 | Incomplete viewer history silently clears re-review | PR | 43960de7; independently approved (25 tests) |
| P5 | Review-only feedback offers Solve but is absent from solver input | PR, additional feedback finding | 99f67e18; review-only behavior approved, inline-context regression P6 pending |
| P6 | Exact feedback adapter loses GitHub side / Bitbucket inline anchors | PR, independent regression finding | Pending |
| H1 | Open restores unrelated workspace through segment history | Hooks/shared navigation | da5d878a; native IPC red→green and independently approved |
| H2 | Done during Fix confirmation still allows dispatch | Hooks | da5d878a; independently approved (30 tests) |
| H3 | Fix reuses a managed chat/Claude conversation | Hooks, additional lifecycle finding | da5d878a; independently approved (30 tests) |

## Completion checks

- Each author's focused regression tests pass, including the independent failure reproductions.
- Independent Codex reviewers retest the exact committed patches; original authors do not approve themselves.
- Queue-origin review-mode publication supports delayed guarded dispatch and cancellation before posting.
- Solver/Fix launch scope and conversation identity are verified for both configured providers in isolated fixtures; separate native evidence from mocked provider and process tests.
- Combined queue native fixture, relevant workspace regressions, build and diagnostic comparison pass on the final integration tree.
- Bitbucket's provider API cannot atomically pin approval to a head. Preserve clear explicit fallback wording; never claim atomic pinning or suggested eligibility.
- User `bun.lock` stays unchanged; no push/release or user-global provider policy changes.

This document is an active checklist. Pending rows are not completion claims.

## Combined native navigation regression

The original `32e9ceaf` code fails through the real Queue Open button, preload/IPC and main route when the Repositories segment has a saved workspace from another project. After the hook patch, the same fixture passes and asserts selected project, segment, null active workspace and empty unrelated cwd. Unified ticket/PR/hook visibility, Open without acknowledgment, Done/Undo, Later/BringBack, trusted synthetic runner cleanup and failure retention also pass (3.45s). This is an isolated Queue surface with actual stores; it is not a full-shell visual or provider-launch claim.

## Independent PR fix retest

A separate Codex reviewer approved `43960de7` for the original four defects after 25 tests, including adapted original reproductions. Broader own-PR feedback remains open: top-level review-only feedback was independently reproduced as unsolvable because the solver fetched only issue/inline comments. The author is correcting that; publication Undo and actual native launch verification are separate in-progress checks.

## Independent ticket/hook retest

A separate Codex reviewer approved ticket `2a18176f` and hook `24477d22`. Independently ran 24 ticket and 30 hook tests, including original regressions and controlled provider/renderer behavior. An additional two-process real SQLite Start probe produced exactly one workspace creation/link (one CREATED, one REJECTED). Actual CLI execution remains a separate native test.

## Initial combined regression pass

At integrated `ebd405bd` (review-body feedback patch included), 208 tests across 25 isolated Bun suites pass. The desktop production build passes. Main/renderer type checks retain global diagnostics (57/78 on this tree); none match the reviewed queue/solver paths. This is not a claim of globally clean TypeScript. Publication Undo and native local launch fixtures are not part of this snapshot and require their own final checks. The root monorepo build also invokes the unrelated website, whose Next dependency is absent in this isolated worktree; the supported desktop build ran from `apps/desktop`.

## Follow-up feedback context review

Independent retest of `99f67e18` passed review-only continuation, selected IDs/fresh text, account switching, incomplete-page rejection, occurrence dedupe and no-thread publisher safeguards. It found lost GitHub diff-side and Bitbucket inline file/line context in the new feedback input adapter. Both provider cases are assigned back to the author; this unit is not approved for final integration until corrected. Queue-origin solver publication must also use delayed guarded publication, including its Git push and per-reply mutations.
