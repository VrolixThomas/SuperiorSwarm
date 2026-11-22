# PR fetch timeout correction

The observed PR #12359 failed twice during `git fetch`, before a new checkout or agent launch. The previous subprocess limit was 45 seconds, acquisition 60 seconds, and preparation 65 seconds. The second recorded attempt lasted approximately 49 seconds including metadata.

Read-only repository inspection found 2,347 distinct local branch tips while the current HEAD was dated 2025-11- 18. The authenticated isolated fetch shared the repository's objects but advertised only HEAD with `--negotiation-tip`, so newer local branch histories were excluded from negotiation. The precise amount of excess network traffic in the failed attempts was not recorded.

## Changes

- Generate disposable refs for all local branch/remotes commit tips plus HEAD inside the isolated Git directory. Share only the existing object storage and validated shallow boundaries; preserve source refs, checkout, shallow metadata and credential isolation.
- Stream `git fetch --progress` stderr through a strict numeric parser. Display Git stage, object counts, percentages and transferred bytes; never expose raw output, remote names, URLs or credentials.
- Replace the 45-second process cap with 120 seconds without measurable progress and an independent 10-minute total cap. Byte growth counts as progress even when object counts do not change. Repeated/noisy output does not extend a stall indefinitely.
- Keep metadata/auth lookup limits at 60 seconds. Acquisition and preparation bounds are 12 and 13 minutes respectively; local checkout remains bounded separately. Cancellation kills the owned process group and prevents later launch.
- Persist progress only for the exact preparing run/attempt, at most once per second except stage changes/completion. Coalesce stage activity instead of appending a line per chunk.

## Validation

- 34 focused runner/acquisition/error tests passed, including actual disposable Git fetches through the authenticated transport boundary, all-tip negotiation, mixed full/shallow histories, unchanged source state, lookup timeouts, process-tree cancellation and redaction.
- 18 jobs/preparation tests and 3 isolated UI/runtime suites passed in the integration lane.
- Production Electron/Vite build passed. Changed-file main/renderer/test type audits introduce no diagnostics; existing repository-wide type errors remain.
- Independent review found and verified fixes for lookup deadline regression and shallow-boundary preservation. No remaining substantive findings.

No live provider retry, production database mutation, checkout creation or Codex launch was performed to validate this change. A real PR retry after loading the new main process is still needed to measure live Bitbucket latency.

Reference: [Git fetch negotiation documentation](https://git-scm.com/docs/git-fetch#Documentation/git-fetch.txt---negotiation-tipltcommitgtltglobgt).
