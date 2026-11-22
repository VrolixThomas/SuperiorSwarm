# Provider reviewer identity and revision metadata — Lane C

Updated after the approved Lane C blocker follow-up. Commit chain starts with `be9631d7` (identity), then `00174a1e7bf1791802f818a7021d79e8fb26b1e2` (complete manifests), then the Bitbucket thread-normalization commit containing this update. Built on frontend checkpoint `163c7059`. No dependency on the other follow-up lanes, new migrations, AppRouter registration, or renderer changes. Parent owns final Mine wiring and CLAUDE.md integration.

## Current-reviewer contract

Existing routers expose `github.getCurrentReviewer` and `atlassian.getCurrentReviewer` (the latter is Bitbucket only).

Input is `{ host, owner, repo, accountId: string | null }`. `accountId` is the saved connection ID returned by that provider's `getStatus`, never a display name. Host must be `github.com` or `bitbucket.org` respectively. Other hosts return `unsupported-host` without sending credentials.

Both return the input scope and `provider`, plus either:

- `{ status: "available", identity: { id: string, login: string | null } }`
- `{ status: "unavailable", reason: "disconnected" | "account-changed" | "unsupported-host" | "lookup-failed" | "missing-provider-identity" }`

GitHub uses authenticated REST `/user`: `identity.id` is its database ID converted to string and `login` is the real provider login. Bitbucket uses authenticated `/2.0/user`: `identity.id` is the UUID, `login` is null, and the returned `account_id` must match the selected saved account. Neither provider derives identity from a display name, email, or nickname. Old saved credentials need no migration: the lookup reads the provider. Missing/mismatched fields fail closed.

No identity is cached or persisted by the main process. The lookup checks account and credential continuity after awaiting the response, dropping results from a disconnected/switched/reconnected connection. A Bitbucket token refresh during lookup conservatively returns `account-changed`; the next lookup can succeed. Late GitHub REST/GraphQL 401s may clear only the credentials used by that request, never a replacement connection.

Renderer integration must key queries by **router/provider + host + accountId + owner + repo**, suppress unavailable/stale identity, and clear/invalidate identity when connection mutations invalidate `getStatus`. Do not use placeholder/previous-account query data. A same-account reconnect must also invalidate identity. Parent should connect Mine to `comment.authorId === identity.id`; GitHub may use the actual login when an old comment lacks an ID. Bitbucket must never fall back to display-name matching. Missing identity/author IDs remain unavailable rather than guessed.

## Thread and revision fields

- `GitHubReviewComment.authorId?: string | null`: GitHub GraphQL User/Bot `databaseId`, or Bitbucket comment user `uuid`. Deleted/missing authors yield null. Display `author` remains unchanged.
- GitHub PR details now request/map `isOutdated` and `originalLine`. `line` remains the provider's current line, including null; originalLine is never copied into it. `diffSide` is retained exactly. Deleted thread/conversation authors no longer crash mapping.
- The existing GitHub `baseCommitOid`/`headCommitOid` fields already came from provider GraphQL OIDs at the shared checkpoint.
- Bitbucket supplies base/head from `destination.commit.hash` and `source.commit.hash` in the same metadata response, then re-reads metadata after collecting files and comments to reject revision drift. The raw metadata reader preserves missing base as undefined and missing head as the existing empty-string sentinel; assembled details fail explicitly if the revision pair is missing or changed. Snapshot callers must validate full OIDs and never substitute branch names.

## Non-obvious source routing

- `main/providers/reviewer-identity-core.ts` performs provider-independent scope/account/in-flight checks; `reviewer-identity.ts` binds real auth and user endpoint fetches. Types live in `shared/reviewer-identity.ts`.
- Auth `getStatus` still supplies connection metadata only; reviewer identity is the new separate read RPC. GitHub author display names saved by OAuth are not login identities.
- GitHub full review-thread metadata comes through `github/github.ts::getPRDetails`, not the smaller `getGitHubReviewThreads` polling result (which intentionally contains only node ID/resolution).
- Bitbucket `atlassian/bitbucket.ts::getBitbucketPRDetails` supplies revision metadata; `providers/bitbucket-adapter.ts::getPRDetails` assembles the shared review model.
- Atlassian auth-core captures fetch when constructed. Isolated RPC tests install the fetch double before importing auth, as well as replacing DB with an in-memory test database.

## Validation and limits

Logs: `/tmp/pr-provider-validation/`.

- RED cases observed: outdated thread mapping/null deleted author, missing Bitbucket revision fields, lost author UUIDs, late GitHub 401 erasing a replacement account; identity contract initially absent.
- Focused suite: 141 reported tests passed across 12 files. The three isolated wrappers additionally execute 4 RPC, 22 manifest, and 9 Bitbucket-thread cases (173 substantive cases excluding wrapper duplication). Includes account switches/reconnects/disconnects, old saved auth, unavailable identities, matching author IDs, raw provider metadata, auth refresh regressions, and review-thread helpers.
- Production build passed. Scoped Biome passed with two preexisting non-null assertion warnings in `github.ts`. `git diff --check` passed.
- Main-process TypeScript diagnostics compared with a local pre-change baseline; renderer/test diagnostics compared with parent's final checkpoint logs. Zero additions after normalizing worktree paths/line offsets. Global type-check remains failing on existing diagnostics.
- Graphify rebuild attempted and unavailable (`ModuleNotFoundError: graphify`).
- No live authenticated metadata smoke test; final provider/RPC regression tests use isolated DB and provider doubles. No real review/comment writes or terminal prompts, pushes, merges, dependency installs, native rebuilds, or lockfile edits.
- GitHub's existing page caps (100 threads, 30 comments per thread) remain. Missing metadata is not populated from fixtures.
- The approved follow-up fixes Bitbucket root/reply grouping, sides, outdated anchors, and explicit resolution certainty as described below. The separate polling-only `getReviewThreads` method still returns an empty list; this work changes the full review-details model and does not introduce resolution mutations. The legacy GitHub REST rename helper `getPRFiles` is outside the full-details manifest contract; path coverage and `filesComplete` use the fully paginated GraphQL details route.

Provider references checked: [GitHub review-thread fields](https://docs.github.com/en/graphql/reference/pulls#pullrequestreviewthread), [Bitbucket current user](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-users/#api-user-get), [Bitbucket PR/comment metadata](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/).

## Self-review

Implemented identity/GitHub metadata/OID scope is verified with remaining provider limitations explicit.

| Axis | Score | Evidence / next improvement |
| --- | --- | --- |
| Accuracy | 4 | Raw provider and RPC tests pass; live authenticated smoke testing remains unperformed. |
| Completeness | 4 | All requested Lane C blocker APIs are supplied; parent owns integrated Mine/unknown-resolution UI verification. |
| Clarity | 4 | Scope and matching rules are explicit; the two provider ID formats require care during integration. |
| Actionability | 4 | No migration or other-lane dependency; parent must wire query invalidation and matching. |
| Conciseness | 4 | Small service/core split isolates lifecycle tests; handoff includes necessary cross-lane details. |

Overall 4.0/5. Highest-impact follow-ups: verify integrated Mine matching/connection invalidation and unknown-resolution presentation, then perform an authenticated read-only provider smoke test. The user should agree that these are concrete integration boundaries rather than a claim of globally clean validation.


## Completed blocker follow-up

`GitHubPRDetails.filesComplete?: boolean` is exactly the contract required by A `213fba2f`. Only successful full `getPRDetails` reads set it true. `mapPRDetails` alone cannot certify completeness. GH follows `pageInfo.endCursor` until the final page and validates `totalCount`, `changedFiles`, unique file paths, valid records, cursor progress, and consistent head/base OIDs on every page. A failed, malformed, truncated, repeated, or revision-mismatched page throws. BB diffstat follows every page, rejects non-OK/malformed/repeated pages, duplicate paths and any provided size mismatch, and keeps next links within the original repository/API host. Its assembled details verify the head/base pair again after collection. No silently partial list is returned as complete.

`GitHubReviewThread.resolutionKnown?: boolean` is additive. GitHub emits true for provider boolean resolution. Bitbucket emits true only for an explicit `resolution: null` (known open) or a resolution object (known resolved); absent/malformed resolution yields false. Its required legacy `isResolved` remains false in that last case **as a placeholder, not an open fact**. Parent must check `resolutionKnown !== false` before presenting a known Open/Resolved state or inferring resolution-dependent actions/counts.

BB comment `inline.to` is the right-side coordinate; `inline.from` is used on the left when no `to` exists. Outdated coordinates become `originalLine` and `line` is null. Unknown `outdated` is left undefined. File-only comments retain null line (their required RIGHT side is an inert legacy placeholder). Root metadata controls the whole thread; reply copies of inline/resolution fields never override it.

Replies are joined through `parent.id`, including nested replies and parents arriving on later pages. The root appears first, followed by replies in provider order. Replies are not duplicated as conversation comments. Deleted roots remain with a deleted-body placeholder so replies survive. Missing/cyclic parent references have no proved anchor and remain visible as unanchored conversation comments. Comment collection rejects page cycles, duplicate IDs, malformed pages, and failed requests rather than grouping an ambiguous/partial result. General non-inline discussions remain flat in the preexisting conversation-comment model.

Additional primary source for parent relationships: [Atlassian comment event payload](https://support.atlassian.com/bitbucket-cloud/docs/event-payloads/). Field semantics were checked against the [Bitbucket Cloud REST reference](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/), not Bitbucket Server's different thread fields.

## Verification matrix for parent independent review

| Check | Result | Evidence / remaining work |
| --- | --- | --- |
| GH multi-page files, zero files, complete flag | PASS | 101-file and explicit-zero raw response cases; pure mapping never marks complete. |
| GH partial/malformed/duplicate/cyclic/revision-drift pages | PASS | All fail explicitly; 22 manifest cases include these and BB coverage. |
| BB all-pages-or-error / before-after revision check | PASS | Failed first/later pages, count mismatch, malformed pages, wrong host/repo, duplicates/cycles, and head drift rejected. |
| BB root/reply/outdated/side/resolution certainty | PASS | 9 isolated raw cases including cross-page parents, nested replies, unknown states, deleted roots and orphan/cyclic lineage. |
| Identity and neighboring provider regression suite | PASS | 141 top-level reported passes; isolated child cases noted above; no failures. |
| Production build, scoped Biome, diff whitespace | PASS | Logs `threads-build.log`, `threads-biome.log`, `threads-tests.log` under `/tmp/pr-provider-validation/`; two preexisting GitHub non-null assertion warnings. |
| TypeScript delta | PASS | Main/renderer/tests compared against pre-follow-up logs, with line-offset normalization: zero added diagnostics. |
| Global TypeScript / graphify | FAIL (baseline/unavailable) | Existing repository diagnostics remain; graphify module unavailable and normal commit hook reports it. No hook bypass. |
| Live authenticated provider metadata | UNVERIFIED | Final tests use in-memory DB and read-only provider doubles. |
| Merged UI Mine, unknown resolution labels/actions, runtime + A coverage gate | UNVERIFIED HERE | Parent integrates and independently reviews; C supplies exact API/fields and no renderer edits. |

No A migrations, AppRouter registrations, parent/sibling files, global config, lockfiles, external provider mutations, or review terminal prompts were changed. Parent can cherry-pick the scoped C commits in order; there is no dependency on A/B/D code to build them.
