# External queue independent review follow-up

Integration base: `32e9ceaf`, plus completed SUP-45 verification from `014e5e79`. This integration branch is separate from the user's `activity-queue` branch. No external service posts are used by verification.

## Findings being corrected

| ID | Independent finding | Owner | Fix/retest evidence |
| --- | --- | --- | --- |
| T1 | Status-only changes resurrect dismissed ticket feedback | Ticket | c61040fa; independent retest pending |
| T2 | Edited pending comments keep obsolete text | Ticket | c61040fa; independent retest pending |
| T3 | Start accepts acknowledged occurrence | Ticket | c61040fa; independent retest pending |
| T4 | Concurrent Start requests create duplicate work | Ticket | c61040fa; independent retest pending |
| P1 | Successful approval can post twice after local cleanup failure | PR | 43960de7; independent retest pending |
| P2 | Solver cleanup deletes another provider/workspace session | PR | 43960de7; independent retest pending |
| P3 | Solver starts from stale comments after failed refresh | PR | 43960de7; independent retest pending |
| P4 | Incomplete viewer history silently clears re-review | PR | 43960de7; independent retest pending |
| H1 | Open restores unrelated workspace through segment history | Hooks/shared navigation | da5d878a; native IPC red→green, independent retest pending |
| H2 | Done during Fix confirmation still allows dispatch | Hooks | da5d878a; independent retest pending |
| H3 | Fix reuses a managed chat/Claude conversation | Hooks, additional lifecycle finding | da5d878a; independent retest pending |

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
