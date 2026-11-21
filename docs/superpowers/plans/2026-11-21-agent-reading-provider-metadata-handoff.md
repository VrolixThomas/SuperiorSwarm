# Provider reviewer identity and revision metadata — Lane C

Built on frontend checkpoint `163c7059`. No dependency on the other follow-up lanes, new migrations, AppRouter registration, or renderer changes. Parent owns final Mine wiring and CLAUDE.md integration.

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
- Bitbucket supplies the same fields from `destination.commit.hash` and `source.commit.hash` in **one PR metadata response**. Removed the adapter's second head-state read. Missing base remains undefined; missing head remains the existing empty-string sentinel. Snapshot callers must validate full OIDs and never substitute branch names.

## Non-obvious source routing

- `main/providers/reviewer-identity-core.ts` performs provider-independent scope/account/in-flight checks; `reviewer-identity.ts` binds real auth and user endpoint fetches. Types live in `shared/reviewer-identity.ts`.
- Auth `getStatus` still supplies connection metadata only; reviewer identity is the new separate read RPC. GitHub author display names saved by OAuth are not login identities.
- GitHub full review-thread metadata comes through `github/github.ts::getPRDetails`, not the smaller `getGitHubReviewThreads` polling result (which intentionally contains only node ID/resolution).
- Bitbucket `atlassian/bitbucket.ts::getBitbucketPRDetails` supplies revision metadata; `providers/bitbucket-adapter.ts::getPRDetails` assembles the shared review model.
- Atlassian auth-core captures fetch when constructed. Isolated RPC tests install the fetch double before importing auth, as well as replacing DB with an in-memory test database.

## Validation and limits

Logs: `/tmp/pr-provider-validation/`.

- RED cases observed: outdated thread mapping/null deleted author, missing Bitbucket revision fields, lost author UUIDs, late GitHub 401 erasing a replacement account; identity contract initially absent.
- Focused suite: 139 reported tests passed across 10 files, plus the 4 real cases executed within the isolated RPC wrapper. Includes account switches/reconnects/disconnects, old saved auth, unavailable identities, matching author IDs, raw provider metadata, auth refresh regressions, and review-thread helpers.
- Production build passed. Scoped Biome passed with two preexisting non-null assertion warnings in `github.ts`. `git diff --check` passed.
- Main-process TypeScript diagnostics compared with a local pre-change baseline; renderer/test diagnostics compared with parent's final checkpoint logs. Zero additions after normalizing worktree paths/line offsets. Global type-check remains failing on existing diagnostics.
- Graphify rebuild attempted and unavailable (`ModuleNotFoundError: graphify`).
- No live authenticated metadata smoke test; final provider/RPC regression tests use isolated DB and provider doubles. No real review/comment writes or terminal prompts, pushes, merges, dependency installs, native rebuilds, or lockfile edits.
- GitHub's existing page caps (100 threads, 30 comments per thread) remain. Missing metadata is not populated from fixtures.
- Preexisting Bitbucket review adapter limitations were reported to parent: it defaults resolution to false/right-side and does not group replies. This initial commit adds UUID identity and exact OIDs without inventing equivalent resolution/anchor semantics. Parent coordination for a separate scoped follow-up is pending.

Provider references checked: [GitHub review-thread fields](https://docs.github.com/en/graphql/reference/pulls#pullrequestreviewthread), [Bitbucket current user](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-users/#api-user-get), [Bitbucket PR/comment metadata](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/).

## Self-review

Implemented identity/GitHub metadata/OID scope is verified with remaining provider limitations explicit.

| Axis | Score | Evidence / next improvement |
| --- | --- | --- |
| Accuracy | 4 | Raw provider and RPC tests pass; live authenticated smoke testing remains unperformed. |
| Completeness | 4 | Lane APIs and metadata are supplied; parent owns Mine glue and Bitbucket legacy thread normalization requires coordination. |
| Clarity | 4 | Scope and matching rules are explicit; the two provider ID formats require care during integration. |
| Actionability | 4 | No migration or other-lane dependency; parent must wire query invalidation and matching. |
| Conciseness | 4 | Small service/core split isolates lifecycle tests; handoff includes necessary cross-lane details. |

Overall 4.0/5. Highest-impact follow-ups: wire Mine with ID-based matching and connection invalidation, then correct Bitbucket legacy thread semantics with explicit unknown state. The user should agree that these are concrete integration boundaries rather than a claim of globally clean validation.
