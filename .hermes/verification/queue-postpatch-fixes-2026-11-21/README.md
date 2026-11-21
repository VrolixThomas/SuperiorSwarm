# Post-patch inbox, scope and managed coordinator fixes

Codex, sole writer in Lane A. Merged requested integration commit `709687f8`; only equivalent CLAUDE conflict resolved to staging. Independent tests `4e9fe42e` and `316bff44` were cherry-picked without changes. No shared DB policy, app/config, lockfile, push, merge into parent, release or provider trust changes.

## Causes and fixes

- **Inbox starvation — `4c025696`:** SQL limited the newest 200 rows before applying conversation visibility. Exact/legacy visibility now runs in SQLite before LIMIT 200 for both workspaces and coordinators. Unread exact answers are ordered oldest first, with an ID tie-breaker, ahead of history. Pending answers bypass the history `since` cursor until retrieved. Deferred HTTP reads repeat the same page until confirmed; only returned records receive direct-reader receipts. Tests cover 201 sibling answers, 205 legitimate answers mixed with 201 newer notes, retries and draining, bounded counts, wrong generation/provider/entity/project and missing identity.
- **Dynamic scope — `4c025696`:** queue context queried only explicit links, ignoring `accessScope=all`. The new `cross-repo-project-scope.ts` helper supplies both control-plane authorization IDs and queue display scope. All-project scope follows current repo/folder inventory, including additions/removals; selected scope remains limited to links. The coordinator retains its own directory and no arbitrary project ID.
- **Production coordinator dispatch — `c7e1f69e`:** service/HTTP lookup accepted only workspace rows. The new coordinator branch uses its own directory and the existing production spawn/session-registration path. It creates no surrogate workspace or terminal rebinding. Full coordinator scope is required; project-scoped callers and external-manager targets are rejected. Selected callers cannot launch an all-project coordinator. Credentials/scope are rechecked after confirmation; external-manager confirm/auto policy is retained. Dispatch alone does not clear a prior report.
- **Exact coordinator resume and provider defaults — `85ee890f`:** resume likewise stopped at a workspace-only lookup. Coordinator resume requires one identified managed conversation, uses guarded existing manager transitions, and rechecks identity/authority after waits before writing. Missing, ambiguous, replaced, active, or unauthorized targets fail without legacy respawn or sibling fallback. Audit uses the coordinator's own durable journal. Omitted launch provider honors configured Claude/Codex; unsupported configuration fails rather than selecting Claude. New coordinator dispatch defaults to permissions enabled (`skipPermissions=false`).

The old coordination audit fixture expected recipient deletion to convert a DM into a broadcast via SET NULL. It now asserts retained recipient history and no leakage to other inboxes, matching migrations 0067/0068; no production retention change was made in this follow-up.

## Validation

- Initial inbox/scope run: **1 pass, 7 failures**. Final owned inbox/scope acceptance: **8 pass, 470 assertions**.
- Final targeted run, including both independent repro files: **42 pass, 780 assertions** across five files.
- Dispatch/inbox/control-plane/manager boundaries: **145 pass, 1,095 assertions** across ten files.
- Resume/coordination/manager boundaries after the final guard: **48 pass, 214 assertions** across five files.
- Production desktop build passed from `apps/desktop`. Biome passed on nine owned source/test files. Main TypeScript retains exactly the baseline 61 diagnostics after path/position normalization, with zero added/removed; test-project check reports 204 diagnostics, no new diagnostics in the changed implementation/test paths (pre-existing control-plane DTO diagnostics remain). This is not a globally clean TypeScript claim.
- Provider-shaped and production spawn/HTTP tests use isolated SQLite, sockets, directories, broadcasters and daemon stand-ins. No new authenticated provider probes were run by A; original investigator continues independent native/live verification. Graphify remains unavailable; normal commit hooks were not bypassed.

## Additional actual cold Codex bootstrap failure and correction

The investigator demonstrated that normal cold Codex can initialize MCP before SessionStart, not merely in a synthetic ordering test. The previous fail-closed startup left that process unbound. Root assigned the correction to A.

**`8571db81`** adds server-issued admission tied to the original supplied entity/terminal. Context resolution waits event-aware up to five seconds for the first validated registration and revalidates it before responding. Timeout returns a 30-second lease; bounded asynchronous post-connect/first-tool exchange can admit only the captured first generation. A replacement, close, wrong provider/entity, unobserved registration, expiry or server restart rejects instead of selecting the latest conversation. Existing pins stay immutable. Registry storage is capped at 512 leases.

Actual MCP-process late-hook tests for both provider shapes pass without restarting the process. Lease tests cover replacement before response, unexchanged replacement, expiry and mismatched ownership. Bootstrap boundaries: **57 pass / 1,855 assertions** across six files; production build passed. The independent normal-cold authenticated/native observer must still rerun on this commit before claiming that live failure fixed. The investigator's original expected-missing-owner characterization is retained untouched in this lane; its owner was asked to convert it to the new required positive expectation.
