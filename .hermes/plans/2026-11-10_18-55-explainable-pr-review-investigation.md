# Explainable PR review: guided flows and revision-grounded questions

Investigation and implementation proposal · 2026-11-10, Europe/Brussels

Source baseline: `17a316bf5fd73c0c6883128637398aa14bb81c05` (`v0.23.4`). Status: **planning only; no product implementation**. All paths below are relative to the repository root; `src/` and `tests/` in implementation tables are relative to `apps/desktop/`. Evidence IDs refer to the exact source ledger at the end.

## Recommendation and product contract

Make **Flows** an optional guided view within the existing Review Mode. A flow is a suggested reading route from a meaningful trigger through changed behavior and state boundaries, ending with supporting tests/configuration/docs. Keep **All files** and ordinary diffs one click away. Support several independent entry points and shared steps. Call this a *suggested reading order*, never “the execution order.”

Use a hybrid: deterministic classification and AST/import analysis establish coverage and order; bounded static symbol resolution adds stronger edges; optional model narration and architectural Q&A explain only retrieved, revision-pinned evidence. Models do not own ordering, citations, completion, or repository access. Allow private user reordering without promoting it to a verified runtime relationship.

The first useful release is pinned revisions + deterministic flows + local progress + a reliable “return to review” trail. Q&A follows only when a genuinely read-only, snapshot-bound tool surface exists. The current review CLI launcher is not that surface.

Acceptance contract:

- Every changed file is visible in a primary flow or an explicit “Other changes”/support group, including unsupported and binary files. No hidden leftovers and no “100% reviewed” over an incomplete manifest.
- Each step answers: what changed here, why it belongs here, how we reached it, what it calls/affects, and which connections remain uncertain.
- Distinguish **changed**, **unchanged context**, **removed**, and **unavailable** code; distinguish a call, import, registration, transport boundary, state access, and heuristic association.
- Questions and excursions do not mark code reviewed. Return restores revision, flow, step, file side, location, scroll/view state, filters, and draft composer.
- Findings remain accessible throughout; high-severity security/correctness concerns surface immediately without taking over navigation. Understanding and acceptance of a finding are separate actions.
- No analysis requires checkout, dependency installation, execution of repository code, a language server launch, or an external write.

## What exists today

| Area | Observed implementation | Consequence for the design |
|---|---|---|
| Main review surface | `MainContentArea` routes the PR segment to `ReviewModeShell`; it switches Overview, Changes, Comments, Terminal and includes a terminal drawer. Legacy `PRReviewFileTab` remains reachable through pane rendering. [E01] | Extend the current shell; do not build the new experience solely in the legacy tab. Keep legacy raw access compatible. |
| Ordering | `useReviewData` maps `details.files` directly into `fileOrder`. `ReviewNavigator` independently renders `details.files`; keymap and comment grouping use `fileOrder`. [E02] | There is no semantic ordering stage. One shared flow projection must feed rail, next/previous, and findings navigation. |
| Other review surface | Working/branch `review/ReviewTab` uses `buildWorkingFileList` and top-level-directory/path sorting. Local branch `review-order-and-md-files-fix` contains commit `98fc5244`, which fixed list parity and Markdown behavior, not semantic order. [E03] | Do not confuse this older fix with PR storytelling. Working-tree review is a separate scope. |
| Revision/data contract | `PRContext` has branches/path but no SHAs; `GitHubPRDetails` has a head OID but no base OID/completeness. `GitHubPRFile` lacks old path; local `DiffFile` and provider `NormalizedPRFile` can represent renames. [E04] | Add an immutable snapshot contract instead of guessing revision from a tab or draft. |
| Content | Changes loads merge-base-to-source-branch diffs, then reads original by merge base and modified by source branch. Cache keys use branch names and repository state version. `getFileContent` tries `origin/` on failure, then returns empty text. [E05] | An explanation can otherwise disagree with displayed code. Missing object must be different from an intentionally absent side. |
| GitHub completeness | GraphQL details use `files(first: 100)` without pagination; review threads/comments also have fixed limits. REST `getPRFiles` requests one page of 100, though it preserves `previous_filename`. Mapping retains provider file order. [E06] | Accurate manifest/coverage and pagination are prerequisites, especially for large PRs. Findings completeness is a separate indicator. |
| Navigation | PR session key is workspace + PR identifier, with active file/thread and per-file scroll in a Zustand Map. Review-mode view/filter/drawer state is another in-memory store. File scroll is restored after model changes. Workspace/tab history exists separately. [E07] | Reuse selection and view restoration, but add revision/step identity and an excursion stack. |
| Persistence | GitHub “viewed” endpoints read/write local SQLite `github_pr_file_viewed`, keyed by owner/repo/number/path, not GitHub itself and not head. Generic `review_viewed` has workspace/path/content hash. Session snapshots save tabs/layout/workspace metadata, not the PR session Map or flow state. [E08] | Do not call current progress GitHub-synced. Add provider-neutral revision-aware progress; legacy marks cannot prove current review. |
| Automated findings | Drafts have commit SHA, chain, round and Markdown summary; comments have path/line/side/status/resolution, but no severity, flow, evidence, or base revision. The UI combines platform threads with draft threads. [E09] | Attach findings by validated revision location, not by prose or filename alone. Preserve existing lifecycle states. |
| Submission | Popover calls `aiReview.submitReview` for a draft; router persists the supplied summary and calls `publishReview`. Publisher uses provider APIs, stores posted comment IDs/status, then verdict/draft completion. It may replace stored commit with current remote head. [E10] | Explanation is not publication authority. Revision mismatch needs explicit handling before eventual submission; do not silently publish old locations at a new head. |
| Agent/tooling | Orchestrator writes prompts and starts CLI review agents; permission-skipping defaults to enabled. Standalone MCP review tools write draft comments/summary/completion to SQLite. Task tokens bind modes/project/workspace. [E11] | Reuse metadata/cancellation concepts, not unrestricted CLI permissions or mutation tools, for architectural Q&A. |
| Refresh | Review workspace setup can fetch/reset branches and continue after update failure. Commit poller watches submitted chains, detects SHA changes, and can queue another review. [E12] | This lifecycle cannot be the snapshot resolver for read-only analysis. Head tracking must also work before any automated review exists. |
| Symbol support | Monaco supports definitions/references; LSP workspace search queries running servers with a 3s timeout and caps normalized results at 100. Generic LSP requests can start servers. [E13] | Useful editor navigation, but not an immutable index or exhaustive caller graph. Never infer “no callers” from a capped/failed search. |
| Graphify | Shared symlink points outside this worktree. Report dated 2026-10-13 has 3,765 nodes/4,316 edges. JSON relations: 2,210 contains, 1,443 calls, 663 method. Manifest values are timestamps; graph metadata is empty. No product call-hierarchy/graph service found in searched source. [E14] | Existing graph is a discovery aid, not exact-PR evidence. No assumption that “EXTRACTED” means resolved cross-file runtime calls. |
| Root safety and telemetry | Registered workspace root validation and symlink-aware editor operations exist. Telemetry currently records lifetime usage counters, not comprehension outcomes. [E15, E16] | Reuse identity validation, but automatic analysis must be stricter than explicit editor link opening. Add only content-free metrics after product/privacy review. |

These are source observations, not results of running the app. No live PR, token store, Keychain, personal database, or agent session was opened. The existing graph was read as a known documentation artifact, not followed as an automatic analysis policy. It was not rebuilt.

## 1. Snapshot and deterministic semantic ordering

### Snapshot first

Resolve a registered repository and PR into `{provider, host, repositoryId, prNumber, targetTipOid, headOid, mergeBaseOid}`. Preserve target tip and merge base separately: the review diff is **merge base → PR head**, not necessarily target tip → head. Branch names are labels. For forks, record source repository identity as well as target identity; matching branch names are insufficient.

All content, hunk coordinates, graph nodes, findings mappings and answers bind to that tuple. Resolve OIDs once, verify objects and types locally, and use object IDs thereafter. Do not fall back to working-tree content, `origin/<ref>`, or empty content. If objects are missing, return a typed missing-object state and an explicit acquisition affordance. Any future fetch belongs to a separate authenticated acquisition path; analysis itself does not fetch or reset worktrees. Remote provider contents, if supported later, must match the pinned commit and be marked with their origin.

Build a complete local tree/diff manifest where objects are present. Preserve modes, old/new paths, blob OIDs, additions/deletions, binary status, hunks and absence per side. Compare provider totals/manifest if available; report mismatches. Paginate metadata and recheck base/head around multi-page acquisition; retry a bounded number of times if they changed, then show “revision moving.” A capped provider list is never a complete local manifest.

If multiple merge bases exist, expose ambiguity and withhold a claim of provider-equivalent diff until a matching base strategy is established. Shallow histories must not silently use target tip as merge base. Zero-change, rename-only, and configuration-only reviews are first-class outcomes.

### A pure, versioned ordering function

Input: snapshot manifest + pinned parser outputs + optional **validated** enrichment + policy version. Output: a persisted flow plan with coverage, evidence and a stable hash. Same input bytes and versions yield identical output regardless of API order, filesystem enumeration, locale, parallel worker completion, or model response. Timings and job IDs do not enter the content hash.

1. **Classify without losing files.** Assign runtime/source, contract/type, migration/schema, test/fixture, configuration/build, documentation, generated/vendor/lock, binary, symlink or submodule. Rules are versioned and record reasons; explicit source evidence outranks filename hints. Read allowlisted manifest/config data as data. Generated headers and `.gitattributes` hints are untrusted classification hints, not permission to hide a file. Root config is not automatically an entry point.
2. **Extract changed symbols on both sides.** Map added and removed hunk ranges to the smallest enclosing declaration plus parent identity: functions, methods, handlers, class fields, module initialization and exports. Preserve old/new spans and fingerprint mapping. Comments/whitespace can yield “non-behavioral edit” but remain reviewable. Syntax failures produce file-level steps, never guessed symbol links. Deleted declarations use base-side symbols; renamed declarations retain explicit mapping confidence. Type-only changes have dependency stories, not fake runtime calls.
3. **Build typed edges.** Initial TS/JS support parses syntax and static imports/re-exports/literal `require`, then resolves local identifiers/imported bindings within a bounded snapshot host. An import is `imports`, not `calls`; a type reference is `type-dependency`. Record call-site ranges, conditional/async context, unresolved candidates and provenance. A bundled TypeScript parser with a restricted in-memory host is a plausible first adapter; `createSourceFile`, AST traversal and a custom module host are documented facilities, not a finished analysis algorithm. [W03]
4. **Discover roots, including unchanged roots.** Ordered root classes: known registration/trigger (UI handler, CLI command, HTTP/tRPC handler, IPC/event subscriber, job); package/process entry declaration; exported changed API with no known local caller; source SCC with no known incoming edge in the bounded graph; file-level fallback. Parse JSX handlers, route registrations, Electron startup, daemon dispatch and tests as separate patterns. `index.ts` by name alone is only a hint. Search incoming edges far enough to find a meaningful unchanged caller, and label the search coverage. Public methods can have external callers absent from the repo.
5. **Keep boundary edges explicit.** For this repo, a renderer `trpc.aiReview.submitReview.mutateAsync` to main router `aiReview.submitReview` is a `dispatches-to` edge with evidence from the client expression **and** router registration. Electron IPC channel literals and daemon message discriminants need equivalent two-ended adapters. A matching string without a verified registration is only a candidate. SQL schema references can show `writes-state`/`reads-state`; do not infer transactionality from table name proximity.
6. **Find flows.** Use high-confidence call/registration edges for reachable changed-symbol sets. Keep distinct triggers even when they reach common modules; do not combine a whole application through a hub such as a DB accessor. Group roots only when their changed reachable sets and trigger identity coincide; expose alternate roots. Roots with no proven connection remain separate. Lower-confidence import/package associations attach isolated changes as a dependency story with a visible fallback reason. Tests are not roots for a runtime story, but are roots when the PR is test-only.
7. **Traverse deterministically.** Collapse strongly connected components (SCCs) in each side's call graph. Run preorder depth-first traversal of the condensed graph from each root: caller/trigger, helper/callee, state/external effect. Inside an SCC, show “mutually dependent” members once, sorted by stable symbol key, with back edges; do not fabricate order inside recursion. At branches, use call-site source offset, then edge-kind rank (`calls`, `dispatches-to`, `registers`, dependency), then canonical target key. Source order is a reading tie-break, not proof of async execution order. Return paths and callbacks can be backlinks, not duplicate linear steps.
8. **Make ties and ownership explicit.** Sort flows by `(root class rank, evidence rank, package path bytes, root path bytes, symbol start offset, symbol ID)`. For a changed symbol reached by several flows, the smallest flow key owns its primary step; other flows show a shared-step reference and local rationale. Multiple unrelated changed symbols in one file may have distinct steps, using the same diff model. A fallback file projection deduplicates on first occurrence. Never make “many findings” or model importance a hidden tie-breaker.
9. **Append supporting material.** Per flow: runtime steps and side effects, then schema/migration details, tests/fixtures, config/docs, generated/lock/binary artifacts. A migration's destructive behavior or a build configuration that causes the change gets an early prerequisite/risk card with a link to its detailed step. Pure build/migration PRs use build/schema stories as roots. This preserves the user's preferred reading rhythm without burying the cause or a dangerous change.
10. **Assert coverage.** Every changed hunk belongs to a primary step or an explicit unassigned file-level step. Every changed file is in the manifest and All files. Shared occurrences do not inflate progress. Unmapped findings stay visible in “Unmapped findings.” Emit counts and reasons for unsupported, omitted-content, unresolved and truncated analysis.

Canonical symbol key: snapshot-side + exact Git path bytes + declaration kind + qualified name + start offset, with overload/anonymous ordinal. Preserve Unicode/case, escape display controls; do not conflate paths on a case-insensitive host. Cross-revision continuity is a separate mapping, not reuse of this key. Normalized fingerprints may suggest continuity, but ambiguous matches require confirmation.

### Confidence and limitations

Use categorical evidence, not an uncalibrated “92% certain”:

| Label | Meaning | UI behavior |
|---|---|---|
| Resolved static link | Binding/call or registered boundary resolved at these snapshot locations | Solid relationship with call-site and target citations; still not proof the branch executes |
| Structural link | Import, JSX composition, type/schema dependency, explicit test import | Label the relationship; never render it as a runtime call |
| Inferred link | Naming convention, ambiguous dispatch, package/test association, source-to-generated hint | Dashed/qualified text and explanation of heuristic; excluded from “verified callers” |
| Unknown / partial | Dynamic load, parse error, unsupported language, budget/missing objects | Preserve raw access and coverage status; “no callers found in indexed scope,” never “unused” |

JS dynamic property calls, reflection, dependency injection, callbacks, event buses, SQL procedures, shell scripts and native helpers cannot be made fully precise by imports. TS type resolution can improve targets but cannot prove runtime behavior. For other languages, begin with classification and language-specific import extraction only where the grammar is supported; list capabilities per adapter. Never apply a JS regex as a universal caller resolver. Cross-language boundaries need explicit contracts/registrations; otherwise terminate at a labeled boundary with candidate links. No dependency code is downloaded for analysis.

For deletions use the **base graph** to explain former callers/behavior and show the replacement, if resolved, in the head graph. Rename detection is evidence with a threshold and possible ambiguity; copies do not automatically inherit review progress. Configuration changes can affect untouched callers: show them as context, not additional changed files. Generated/vendor files remain expandable and counted; no automatic re-generation or source-map fetching.

## 2. Review unit and guided UX

### Flow contract

Each flow contains `id`, deterministic title, title provenance, rationale/reason codes, primary entry and alternate entries, ordered step IDs, boundary/effect summaries, supporting test IDs, shared-step references, confidence breakdown and coverage. Initial titles are templates such as “Submit accepted review comments” or “Prepare terminal file input”; use handler names when intent cannot be established. Optional model titles are display annotations with provenance and cannot change IDs/order.

A step contains a symbol/file location, change status, hunk IDs, role, predecessor evidence, outgoing/incoming edge IDs, side effects, supporting tests, and primary owner flow. Rationale is both machine-readable and human-readable: “Reached from `submitReview` through a direct call to `publishReview`; this step writes draft status after provider calls.” A flow is a narrative grouping, not a claim that all its steps execute on every invocation.

### Screens and interactions

| Surface | Proposed behavior |
|---|---|
| Overview | Revision badge, analysis coverage, concise change intent, compact flow cards with entry, boundary/effect chips, changed-file count, confidence and progress. A small adjacency map can be added later; the ordered list must be complete without a canvas. Show independent flows side by side, not a single root for everything. |
| Flow rail | “Flows / All files” toggle, collapsible flow groups, current step, shared markers, reviewed/revisit/skipped statuses, and support sections. Branch labels describe alternatives. Virtualize large lists; preserve explicit expand and keyboard focus. |
| Diff header/context strip | “Flow 2 · Step 3: Persist publication outcome,” changed/unchanged/base badge, exact short SHA, predecessor and next boundary. “Why am I seeing this?” expands the rule and citations. |
| Callers/callees | Side pane lists resolved, structural and inferred relationships separately with scope and truncation. Allow upstream/downstream expansion on demand; entering unchanged code uses a read-only context viewer at the same snapshot. |
| Questions | Sidecar “Ask about this change” seeded with flow/step/selection, plus prompts for callers, state boundaries and system role. Conversation can broaden to the repository without losing snapshot or return anchor. Explain source coverage before an answer over a partial graph. |
| Findings | Step badges and a non-modal persistent risk strip for high-severity concerns. Ordinary findings expand on demand or at flow end, where the user gets “What changed / questions left / findings to assess.” Keep the existing Comments view for triage. |
| Progress | Separate “opened,” “reviewed,” “needs revisit,” and “skipped.” Mark reviewed is deliberate and local; opening, scrolling, chatting or accepting an AI finding does not mark it. File completion requires all changed steps, counted once. Unknown manifest total means “N known files reviewed; manifest incomplete.” |
| Jump and return | A citation opens an excursion with breadcrumb and “Return to flow 2, step 3.” Back/forward within excursions and a return-to-review action are distinct from workspace back/forward. Jumping to another changed step asks no permission; it preserves the previous anchor. |
| Raw access | All files retains path search, status, split/inline diffs and Markdown controls. Offer provider/path order there. “Open in editor” explicitly exits snapshot context to a mutable workspace and labels that difference. |

Preserve one Monaco diff instance where possible (the current Changes view already supports model swaps). Store both sides' view state and selection under `{snapshotId, stepId, path, side}`; use stable model URIs containing snapshot/side/blob identity. Do not bind historical models to live working-tree LSP documents. While a new file loads, previous content is either visibly labeled as previous content or hidden; do not show old text under a new filename with active comment controls.

The return anchor also records mode, flow expansion, filter, finding/thread ID, composer draft ID, and focus target. Persist after debounced changes and on navigation/close. A question can open several citations; returning restores the original anchor rather than the last citation. Leaving a reply draft must not discard it or accidentally submit it. Shared steps remember the originating flow when returning.

Keep current keyboard bindings in All files; in Flows, next/previous advances the displayed step projection. Add discoverable return/next-unreviewed actions through `review-keymap.ts`, with accessible button equivalents. Text entry and chat capture typing; Escape dismisses the deepest panel/selection first. Announce analysis updates without moving focus. Confidence cannot rely on color alone. Narrow windows switch the sidecar to an overlay that retains anchor and composer state.

## 3. Architectural Q&A with evidence

### Dedicated read-only session

Create an explanation session bound to `{repositoryId, snapshotId, analysisVersion}`. A backend broker exposes only:

- `getReviewManifest`, `getFlow`, `getChangedSymbols`;
- `readSnapshotRange(locationId, boundedWindow)`;
- `findSymbol(query, scope, cursor)`, `findReferences(symbolId, edgeKinds, cursor)`;
- `getIncomingEdges`, `getOutgoingEdges`, `getBoundaryEvidence`;
- `searchSnapshotText(query, approvedScope, cursor)` with literal search by default and bounded output.

Tool results contain typed source records, completeness and source status. Tools accept IDs bound by the broker, not arbitrary paths, shell commands, URLs, repository IDs or revisions chosen by the model. Main-process authorization resolves workspace/project ownership. The model receives no general file-read, terminal, review mutation, message, credential, network-fetch or MCP-manager capability. Prompt instructions alone are insufficient isolation.

Do not launch `buildAndLaunchReview` for this: its CLI presets can run with broad permissions and native CLI tools. Reuse model/provider configuration only if a separate tool-limited inference transport is available. If a selected provider cannot enforce this contract, disable conversational generation for it and retain local structural lookup. Choosing the supported inference transport is an explicit product/engineering decision, not an assumption that current Hermes/CLI sessions are safe.

### Retrieval and answer protocol

1. Capture the return anchor and question scope. Retrieve changed symbols and nearest context first, then expand upstream/downstream or text search as needed. Broad “how does this fit?” questions may cross package boundaries within the same snapshot; they must report unindexed scope.
2. The model returns structured claims with `evidenceIds`, relationship labels and optional uncertainty. The broker resolves evidence IDs to `{snapshot, side, oid, blobOid, path, symbolId?, startLine, endLine}`. Each line range is validated against that blob; deleted lines use base coordinates.
3. Only broker-generated links are clickable. Reject nonexistent files, out-of-range lines, wrong-side symbols, wrong revisions and arbitrary model-authored URLs. Valid syntax/location alone does not prove that a citation supports a claim: require edge evidence for relational claims and evaluate semantic support in the Q&A test set. Unsupported explanations are labeled inference or omitted.
4. Render **Changed in this PR** and **Existing architecture** separately. A quote from a comment/doc is an author's statement, not a verified call relationship. Link assertions about calls to a call site and target/registration, and state writes to the actual operation. No evidence means “I could not establish this from the indexed snapshot,” with a narrower lookup offered.
5. Keep answers and citations attached to the original snapshot. A head update interrupts no reading, but labels the answer historical and offers a new revision session. A new question defaults to the visible snapshot, with a conspicuous historical badge when relevant.

Example answer for the submission flow at the inspected revision: “`SubmitReviewPopover` invokes `aiReview.submitReview` when a draft exists [E10a]. The main router stores the supplied summary, then calls `publishReview` [E10b]. The publisher performs provider calls and records submitted comment rows and draft state [E10c]. These are separate network and local database effects; the code shown does not establish one transaction across them.” The UI must cite each location at its SHA, not merely repeat this document's evidence IDs. The no-draft path calls `review.submitReview` [E10a, E10d] and should appear as an alternate branch.

If asked “what calls `publishReview`?”, return retrieved callers and indexed scope. The inspected router is a demonstrated caller; this investigation does not assert it is the only caller. If asked “why does the config file matter?” in the terminal example below, explain the build-layout dependency with code references, without inventing a runtime call from Vite to the daemon client.

Conversation history is local by default, deletable per PR, and excludes automatic full-file transcripts. Before optional hosted inference, disclose which provider receives selected repository excerpts and honor existing consent plus an explicit explanation setting. “Read-only” does not mean “no data leaves this machine.” This investigation sent no repository content to an external inference service.

## 4. Findings without losing comprehension

Keep current draft/platform thread identities and acceptance workflow. Add a derived `FindingAttachment` keyed by finding ID + snapshot + side/path/range, with primary step, additional affected flows, mapping confidence and freshness. Prefer changed-symbol intersection, then containing file/nearest step, then “Unmapped findings.” Never silently move an old finding to the same line number at a new head.

Add optional structured severity (`critical/high/medium/low/info/unknown`), category, origin and evidence to AI draft findings. Old records become `unknown`, not “low.” Platform comments remain ordinary comments unless the user/provider supplied a classification. Model-assigned severity is visibly an assessment, not verified truth.

Surface critical/high security and correctness findings as soon as available, even during graph generation and even if attached to config/generated material. Show counts, a short concern and a jump action; do not auto-jump or mark anything reviewed. New findings arriving while reading update badges quietly. Defer lower-priority narrative summaries to the end of the relevant flow; let users expand at any time. “Understood this step,” “accept this finding,” and “submit review” remain distinct.

A model answer is not a draft review comment. Converting an answer to a local draft is an explicit later action, with valid diff-line checks. Publication continues through existing deliberate controls. Before enabling explanation-originated drafts, pass expected head/base through submission and fail closed on mismatch, rather than `publishReview` silently substituting latest head. Do not redesign all publication semantics in phase 1; show stale findings read-only in the meantime.

## 5. Persistence and revision changes

Store immutable analysis and mutable user state separately. Suggested additive schema (new `src/main/db/schema-review-explanation.ts`, exported through `schema.ts`; descriptive migration name `add_review_explanation_state`, generated at implementation time):

| Record | Key and essential fields |
|---|---|
| `review_snapshots` | ID; repository/provider/host/PR identity; target/head/merge-base OIDs; policy/parser/resolver versions; manifest hash; creation time; object availability; manifest completeness |
| `review_flow_analyses` | ID; snapshot FK; generation/version; quality tier; status; coverage/reasons; validated plan JSON; content hash; created time. Immutable after publishing a generation. |
| `review_flow_progress` | Local user/profile + snapshot + primary step; status; old/new blob OIDs; hunk fingerprint; dependency-evidence fingerprint; explicit reviewed time. Composite unique constraint. |
| `review_flow_sessions` | Profile + PR identity + workspace association; selected snapshot/analysis; active flow/step; mode; bounded return/back/forward stack; per-model view state; filter; composer references; optimistic concurrency version. |
| `review_flow_overrides` | Profile + snapshot/analysis; custom title/order/grouping operations; original stable IDs; validation result. Keep derived default intact. |
| `review_explanation_conversations` | Session/snapshot IDs; question/answer records; validated citations and retrieval scope; provider/model/prompt version; deletion/retention metadata. No credentials. |

Use SQLite for metadata/user state, with size-limited content-addressed graph/blob cache in app data. Do not store large graph arrays in renderer localStorage or duplicate code text into every conversation. Multi-window writes use a state version and explicit conflict handling; navigation state can be last-writer-wins with timestamps, but reviewed flags must not be silently lost. App shutdown flushes pending state; crashes lose at most the debounce interval. Workspace deletion drops association/navigation state but need not delete PR analysis shared with another workspace; explicit “forget this review/repository” purges all associated content.

Revision reconciliation:

- A new head, changed target tip/merge base, force-push, or relevant analysis-policy version creates a new snapshot/analysis; never mutate old evidence in place. A force-push is treated by content comparison, not assumed ancestry.
- Show “New revision available” and keep the active review readable. Switching is explicit and atomic: manifest, content, graph and findings all switch together. Late old responses cannot replace new state.
- Carry a reviewed step only if old/new blobs, changed ranges and relevant relationship fingerprints match. An unchanged body with a changed caller/schema/config dependency becomes “code unchanged; context changed—revisit.” Unknown dependency coverage also prevents confident carry-forward.
- Map rename progress only with verified old/new identity and compatible context. Similarity-only or multiple matches are suggestions. Deleted steps are historical and removed from the new denominator; added/replaced steps are unreviewed.
- Preserve explicit skipped status as a preference suggestion, but require visibility of new changes. Reordering overrides apply only to unambiguous surviving IDs; show dropped/conflicting overrides and offer reset.
- Partial analysis can be reviewed at file level. Graph enrichment produces a new plan generation; offer “Apply richer flow map,” preserving anchors and valid progress. No rail reorder while the user is reading. “Stale,” “partial,” “failed,” and “cancelled” are separate statuses.
- Missing old objects after Git GC makes historical citations unavailable, not repointed to HEAD. Retain only bounded cache data under the chosen retention policy; notify before purging history pinned by an active session. Never promise indefinite history without retained blobs.

Legacy migration: retain `github_pr_file_viewed` and `review_viewed` for existing surfaces. Import legacy marks as “previously viewed, revision unknown,” not current completion. Keep generic working-tree content hashes out of exact-PR progress. On rollback disable Flows/Q&A, keep additive tables inert, preserve original raw views and draft submission. Older app versions must be tested with the newer migration journal before claiming downgrade compatibility; do not run destructive down-migrations on user data.

## 6. Performance and indexing

Stage A returns a manifest and deterministic classification before any model/LSP work. Stage B parses changed TS/JS blobs and a bounded one-hop import neighborhood, extracts both-side symbols, and builds initial flows. Stage C optionally expands incoming callers, resolves types and known boundaries within selected packages. Queries can enrich a local neighborhood on demand. Large monorepos do not require a full-repository index to open a diff.

Cache layers:

- Parsed syntax: `{blobOid, parser/version, language}`; repository-scoped authorization still applies even if blobs deduplicate.
- Resolved symbols/edges: `{repositoryId, treeOid, configDigest, resolver/version, packageScope}`. The same source blob can resolve differently after an alias/package change.
- Flow plan: `{repositoryId, targetTipOid, mergeBaseOid, headOid, manifestHash, policyVersion, capabilitySet, deterministic enrichmentSetHash}`.
- Answer cache, if used: additionally question/context/evidence IDs + model/prompt version; never reuse text across repositories/profiles on blob identity alone.

Use a worker/utility process for parsing and graph traversal; keep the Electron main thread responsive. Coalesce duplicate jobs like the current git cache, but add cancellation, memory bounds and generation guards—the existing `createGitCache` has none of those. Share computation across subscribers; one tab closing detaches its lease and cancels the job only when no subscriber needs it. Cancellation terminates/abandons worker work and prevents late publication; a Promise timeout alone is insufficient.

Proposed budgets to validate on a documented reference machine (targets, not measured results): classification usable within 1s warm / 2s cold for 100 changed files; first TS/JS flow map within 5s for ≤100 changed files / ≤5 MiB analyzed source; next cached step under 100ms; cancel acknowledgment under 250ms; no analysis-caused UI task over 50ms. Initial caps: 1 MiB per automatic source blob, 20 MiB source bytes and 10k nodes per enrichment job, two workers, 256 MiB aggregate analysis memory, 500 MiB per-repository disk cache. LRU eviction excludes active snapshots. Tune these with traces before broad release.

Time limits must not make a supposedly deterministic plan depend on scheduling. Select work by stable package/path/symbol priority and fixed quotas. Publish the completed deterministic tier, or mark a timed-out tier incomplete; include the exact completed-enrichment set in its identity. Never silently present whichever workers happened to finish as the canonical complete plan.

For thousands of files: stream the complete metadata manifest with explicit pagination, virtualize rail/search, parse only relevant expanded areas, collapse generated groups and retain accurate totals. Avoid all-pairs rename/edge matching; cap similarity work and report “rename analysis incomplete.” Index imports cheaply across package manifests if possible; cap reverse traversal with `hasMore` and scope evidence. Offline users retain raw local snapshot access. Network limits affect metadata freshness, not the ability to read already-pinned local code.

LSP enrichment is optional and later. Existing live servers reflect mutable workspaces and may load repository configuration. Reuse already-running, trusted results only after checking snapshot/document identity and capability; otherwise label them live context outside the review or do not use them. A bundled static adapter is the default. Supporting LSP call hierarchy would require explicit prepare/incoming/outgoing capabilities, cancellation and revision isolation, not merely calling workspace-symbol search. [E13, W04]

## 7. Security and trust boundaries

Repository files, PR bodies, comments, commit messages, graph exports and model responses are untrusted data. Embedded instructions such as “run this script to understand the change” never become actions. The explanation broker's capabilities enforce the boundary even if the model follows malicious text.

| Boundary | Required behavior |
|---|---|
| Repository identity | Main process resolves registered project/workspace to canonical Git object store; renderer/model cannot provide arbitrary roots. Include provider host/account scope in identity and prevent cross-repository cache reads. |
| Paths and links | Read tracked Git blobs from validated tree entries. Check mode and size first. Treat symlink blobs as link metadata; never dereference them. Do not reuse explicit editor symlink-following behavior for indexing. Reject traversal, absolute paths, NULs and ambiguous protocol encodings; test backslashes, Unicode and case collisions. |
| Submodules/LFS | Show gitlink old/new OIDs or LFS pointer and an unavailable-content reason. No recursive initialization, checkout, smudge, download or entry into another repository. A user may separately register/acquire that repository later. |
| Git helpers | Spawn a known Git executable with fixed argument arrays, validated OIDs and literal path handling. Disable external diff/textconv and never request filters or follow-symlinks. Sanitize execution-related environment/config, disable fsmonitor and replacement-object interpretation, and disable lazy object fetching where supported; missing objects are explicit. Test the supported Git version's isolation options rather than relying on ambient user configuration. No shells, hooks, checkout, build, tests or project binaries are used to infer order. Git's documented helper/filter switches justify these precautions. [W01, W02] |
| Parsers/config | Bundle/pin parsers; parse data-only config with bounded extends/aliases and cycle detection inside the snapshot. No loading TS/Vite/Babel plugins or executing JS config, package lifecycle hooks or custom generators. Confine crash/size/CPU failures to workers. |
| Existing graph exports | Optional import only after schema validation, size/path checks and exact blob verification; no recursive symlink discovery. Missing SHA provenance means use as hints and rederive links. Do not rebuild Graphify automatically to review a PR. |
| Content privacy | Exclude credential-like paths/content from automatic context and generated caches by policy; show omitted-content metadata and allow an explicit raw view under existing permissions. No Keychain reads by analysis. No code, questions, titles, paths, hashes or snippets in telemetry/error logs. |
| GitHub | Existing integration requests classic `repo` scope [E17]; do not claim that token is intrinsically read-only. Broker receives only read adapters, never tokens or write methods. No new permission scope is necessary for local ordering; acquisition uses existing authorized integration. |
| Model output/UI | Validate structured citations and edge claims, sanitize Markdown, block embedded remote resources, and render links through an allowlisted snapshot navigator. No arbitrary `file://`, command URLs, localhost service links or automatically followed external URLs. |
| Local persistence | App-private cache permissions, bounded retention/deletion, no secrets in DB records or task context. Snapshot IDs are references, not authorization. Bind all operations to the caller's workspace/profile and enforce limits server-side. |

The new explanation mode must not reuse the existing review mode's write tools, terminal drawer authority or default permission skipping. Explicitly launching the existing coding/review agent remains a different user action. Reading historical code should work without launching it. This proposal changes neither OAuth credential storage nor user global Git configuration.

## 8. Repository examples

These are hand-derived expected plans from local Git objects and inspected call sites, not output from an implemented analyzer. They illustrate truthful grouping and the need for unchanged context. No PR metadata was fetched live.

### Example A: submission and navigation changes within PR #129

Local merge `68d64d0de17d387ff62583937680ae972a9b01ba` identifies PR #129 (`pr-review-ui`). Its parent-to-parent tree comparison has 61 changed paths; this example deliberately uses the focused, 30-file commit slice **`3442ac97315c9a65f9925ce02cd01128b44d76b5` → `49f2445994a9d6f7193ca3e48d39728bbc32e6a1`**. It is not presented as the entire PR manifest. The exact diff was inspected for submission, router, publisher, navigation, launch and workspace changes. [H01]

Suggested flow **“Submit accepted comments and record the outcome”**:

| Step | Changed code / context | Why here |
|---|---|---|
| Entry | `renderer/components/review-mode/ReviewModeShell.tsx` then `SubmitReviewPopover.tsx` | The shell supplies draft ID; the user's submit action chooses draft or direct provider submission. Component composition is labeled composition; `handleSubmit` is the behavioral trigger. |
| Validate/branch | `renderer/lib/pr-review-submit.ts` (`hasSubmitPayload`, `SubmitOutcome`) | Small shared helper/contract supporting the submit action. Removed `postAcceptedDrafts` is a base-side comparison explaining the responsibility shift, not a callable head step. |
| Cross process | `main/trpc/routers/ai-review.ts`, `submitReview` | Client procedure name maps to registered router. Router stores supplied summary, including explicit empty-body semantics, and calls the publisher. |
| Side effects | `main/ai-review/review-publisher.ts`, `publishReview` | Reads accepted rows, validates/remaps paths, performs provider writes, records per-comment submission, gates verdict on no failed/skipped comments, then stores draft completion. |
| Existing architecture | `main/providers/git-provider.ts`, `github-adapter.ts`, `shared`/DB schema; `main/trpc/routers/review.ts` for no-draft path | These are unchanged context for this slice, not changed steps. Provider dispatch and local SQLite are distinct boundaries. Do not infer network success and DB persistence are atomic. |
| Evidence | `tests/review-publisher.test.ts`, `tests/pr-review-submit.test.ts` | Diff adds publisher tests and reduces tests for removed renderer publishing helper. Describe verified test assertions only after reading them; presence/imports alone mean “related tests,” not coverage proof. |

Other changed files in the same slice naturally form additional stories instead of being threaded into submission:

- **Open/reopen a review workspace:** `GitHubPRList.tsx`, `PullRequestsTab.tsx`, `SidebarRail.tsx` (alternate UI entry points) → `lib/pr-review-nav.ts` / `stores/tab-store.ts` (`activateReviewWorkspace`) → `lib/review-mode-nav.ts` / `stores/review-mode-store.ts`. `useReviewAgentActions.ts` → `lib/review-launch.ts` is a related launch branch that attaches a terminal and writes its launch command. Tests: `tab-store`, `review-mode-nav`, `review-mode-store`, `review-launch`. These are multiple triggers, not a proven sequential call chain through every listed file.
- **Navigate and act on inline threads:** `hooks/useReviewKeymap.ts` and `thread/ThreadCard.tsx` / `ThreadActions.tsx` are alternate interaction roots; `views/ChangesView.tsx`, `hooks/useInlineCommentZones.tsx`, `hooks/useThreadDecorations.ts` explain rendering/model swaps; `lib/pr-review-threads.ts`, `lib/review-keymap.ts` provide shared selection/action rules. Tests: `pr-review-threads`, `review-keymap`. UI action dispatch and render/composition edges remain different kinds.
- `ReviewModeShell`, navigation helpers and stores can appear as shared references across these stories. The three groups account for all 22 source files plus 8 tests in this slice without pretending one linear execution traverses them all.

### Example B: complete local PR #161 comparison

Merge `2be26b4f` identifies PR #161 (`terminal-add-files`). Its recorded target parent is `5c3b804069a038670af39a1032cc457bf81d4f0d`; head is **`22917d06113709b01eaa7ba3bcab4c90f406d878`**. The correct local merge base is **`b4a2413f09c5760fa8df6d48d0a16796b24fa15c`**. Comparing target tip directly with head misleadingly includes unrelated shell-output changes; the three-dot/merge-base comparison has **9 changed files**. This is a concrete reason to pin the right base. [H02]

Suggested flow **“Prepare file input when the surviving daemon cannot inspect it”**: unchanged `main/trpc/routers/terminal-files.ts:prepare` calls changed `DaemonClient.fileTarget`; when the returned target is unsupported it calls `legacyFileTarget`, which calls changed `readTerminalProcessIdentity` in `daemon/terminal-process-identity.ts`. The latter invokes a native helper with a bounded timeout. That invocation is an observed side effect to explain; the analyzer does not execute it. [E18]

Suggested flow **“Insert paths using the locally inspected target”**: unchanged `terminal-files.ts` insertion mutation → changed `DaemonClient.insertFiles` → existing `insertLegacyFiles` (same changed file, unchanged supporting method), which consumes/checks the generation lease, rechecks process identity and writes an insertion-only socket frame. Link preparation to insertion as **shared lease/state**, not a direct call from prepare to insert. `daemon-client.ts` has two changed method regions and a primary owner plus a shared reference. [E18]

An early prerequisite chip links **`apps/desktop/electron.vite.config.ts`**: the change places shared main-process chunks alongside native helpers/resources. Explain its detailed diff after runtime behavior under “Build prerequisite”; it is not a runtime callee. Then review `tests/fixtures/terminal-file-electron/main.ts`, `tests/terminal-file-electron.test.ts`, `tests/terminal-file-legacy.test.ts`, `tests/terminal-file-process-identity.test.ts`. Finally show the changed `CLAUDE.md` routing entry and `bun.lock` as supporting docs/lockfile. That accounts for all 9 changed paths. [H02]

A filename sort would lead with documentation/build files and separate the two methods from their context. A pure call graph would miss the packaging cause. A model-only explanation might invent a prepare→insert call. The hybrid makes each of these relationships explicit and qualified.

## 9. Alternatives and decision

| Approach | Benefit | Limitation | Decision |
|---|---|---|---|
| Heuristics only | Fast, deterministic, broad language fallback, offline | Directory/filename role guesses cannot establish callers or transport boundaries | Ship as transparent first tier; insufficient alone for architectural Q&A |
| Full static call graph | Stronger symbol/caller evidence; good for deterministic routes | Expensive and language-specific; incomplete under dynamic dispatch; can merge unrelated stories through shared hubs | Bounded static enrichment, never mandatory whole-repo indexing |
| LLM narrative/order | Good human titles and flexible architectural explanation | Unstable order, invented relationships, privacy/cost, weak exact-revision guarantees | Optional evidence-bound prose/Q&A; cannot create authoritative edges/order |
| Hybrid | Immediate useful structure with progressively stronger evidence; handles build/config causes and runtime paths | More contracts, versioning and UX for uncertainty | **Recommended**, staged so early value does not depend on inference availability |
| User-authored/reordered flows | Human intent can outperform inference; supports preferred pedagogy | Maintenance after rebases, author bias, incomplete coverage | Private overrides first; later opt-in repository-authored manifests, parsed as untrusted declarative data with coverage checks |

Do not optimize for maximum graph density. The product succeeds when the reviewer can explain changed behavior and return from a question, not when every possible edge is drawn.

## 10. Phased implementation and TDD gates

All files/tests in this section are **proposed future work**. No product code or tests were added or run for this investigation. Each phase begins with failing behavioral fixtures, implements the smallest supported path, then runs focused tests. Avoid making a broad type-check/full-suite failure cleanup a hidden prerequisite; repository guidance notes full-suite fd/timeout flakiness.

| Phase | Concrete changes and likely files | TDD and exit gate |
|---|---|---|
| 0. Revision/manifest foundation | New `src/shared/review-explanation-types.ts`, `src/main/review-explanation/snapshot.ts`, `snapshot-reader.ts`; extend `shared/github-types.ts`, `main/providers/types.ts`, GitHub/Bitbucket adapters, `main/github/github.ts`; new `main/trpc/routers/review-explanation.ts` registered in `routers/index.ts`. Route explanation diffs through exact objects rather than altering generic working-tree diff semantics. | New `tests/review-explanation-snapshot.test.ts`: merge-base vs tip, fork same-name branches, moving base/head between pages, >100 files, missing/shallow objects, added/deleted/renamed/binary files, multiple bases, no fallback to empty/HEAD. Extend `github-pr-details.test.ts`, `github-api.test.ts`, `github-adapter.test.ts`. Gate: complete manifest or explicit partial state and one snapshot identity everywhere. |
| 1. Deterministic plan | New `main/review-explanation/classify.ts`, `changed-symbols.ts`, `graph.ts`, `order.ts`, `adapters/typescript.ts`, `worker.ts`, `jobs.ts`, `cache.ts`. Bundle parser in desktop build and make dependency placement explicit in `apps/desktop/package.json`/`electron.vite.config.ts` at implementation time. | New `review-flow-order.test.ts`, `review-flow-symbols.test.ts`, `review-flow-jobs.test.ts`: shuffled input yields identical IDs/order/hash; multi-root, SCC recursion, unrelated changes, same-file multiple symbols, removed calls, type-only, import≠call, unsupported language and parse failures, generated/config/test-only, complete coverage, cache isolation, cancellation/late completion. Golden fixture expectations from H01/H02 plus synthetic fixtures; no runtime execution of repository code. |
| 2. Guided reading and durable state | Add `review-mode/navigator/FlowSection.tsx`, `FlowOverview.tsx`, `FlowStepContext.tsx`, `ReviewContextPane.tsx`; update `ReviewModeShell`, `useReviewData`, `ReviewNavigator`, `ChangesView`, `OverviewView`, keymap, `lib/review-mode-nav.ts`, `stores/pr-review-session-store.ts`, `review-mode-store.ts`, `session-snapshot.ts`. Add schema/migration and `main/review-explanation/state.ts`; reuse raw editor. | Extend `pr-review-session-store`, `review-mode-nav`, `review-mode-store`, `review-keymap`, `session-navigation-persistence` tests. New `review-flow-state.test.ts` and disposable Electron `review-flow-navigation.test.ts`: exact return after several citations, same-file different steps, keyboard/rail parity, raw toggle, composer survives, restart/multi-window, stale response cannot overwrite, enriched map never steals focus. Gate: pinned state survives context excursions and restart. |
| 3. Evidence and architectural questions | Add `evidence.ts`, `retrieval.ts`, `answer-validation.ts`, `question-service.ts`, `adapters/trpc.ts`, `adapters/electron-ipc.ts`; add `review-mode/ReviewQuestionPanel.tsx`. Select a tool-limited inference transport; if MCP is used, add separate explanation mode in `main/control-plane/task-registry.ts`, server mode validation and `mcp-standalone/server.mjs` with allowlisted read tools only. Do not attach current review CLI. | New `review-explanation-qa.test.ts`, `review-explanation-security.test.ts`: fabricated/wrong-revision/wrong-side lines rejected; unchanged code labeled; broad questions report partial scope; call claims require matching edge evidence; injection cannot execute/write/send; revoked session cannot read; no provider capability means clear unavailable state. Human rubric on H01/H02 asks entry, callers, effects, persistence and config cause. Gate: citation validity and containment 100% in adversarial fixtures, no confident unsupported edge claims in reviewed eval set. |
| 4. Findings and revision reconciliation | New `finding-map.ts`, `reconcile.ts`; optional fields in `schema-ai-review.ts`/shared draft types; update thread badges/Comments view/Overview and commit/head freshness wiring. Extend submission DTOs and `review-publisher.ts` expected-head checks before enabling conversion/publication of explanation-derived drafts. | `review-flow-findings.test.ts`, `review-flow-reconcile.test.ts`; extend `review-publisher.test.ts`: urgent finding arrives during reading without navigation; unknown severity not suppressed; moved/deleted lines remain historical; rename with ambiguous mapping resets progress; unchanged function with changed caller revisits; force-push and base-only changes; stale publish blocked; partial plan cannot report complete. |
| 5. Bounded scale and optional control | Package-level reverse indexes, cache eviction/retention UI, user reorder/title operations, optional validated LSP adapter and content-free instrumentation. Relevant existing telemetry surfaces are `shared/telemetry.ts`, `main/telemetry/state.ts`, `snapshot.ts`, `sync.ts`; any remote schema extension needs separate rollout. | `review-flow-scale.test.ts`, cache/reorder tests, performance fixture with 10k changed metadata rows and 100k repository entries, generated-heavy/unsupported/multi-package fixtures. Measure cold/warm memory and latency, kill workers, evict cache, offline reopen. Gate: budgets above or explicit tier fallback; no UI freeze, missing files or unwanted execution. |

Proposed tRPC API contract (renderer talks through existing preload/tRPC transport):

| Procedure | Input → output |
|---|---|
| `reviewExplanation.resolveSnapshot` | registered workspace + provider PR identity → immutable snapshot, object/completeness state; no checkout/fetch |
| `startAnalysis` / `cancelAnalysis` | snapshot ID + tier/subscriber → job/generation status; local jobs only |
| `getAnalysis` | analysis ID + cursor → plan slice, coverage, `hasMore`, generation; use bounded polling initially |
| `getSnapshotFile` | snapshot ID + manifest file ID + side → content or typed absent/binary/omitted/missing response with blob ID |
| `getRelations` | snapshot ID + symbol ID + direction/kinds + cursor → evidence-bound edges and coverage |
| `saveSession` / `setStepProgress` | snapshot/analysis/session version + typed state delta → persisted version; reject mismatches |
| `ask` / `cancelQuestion` | session/snapshot + bounded text + selection IDs → answer job; result claims reference validated evidence IDs |
| `getRevisionDelta` | old/new snapshot IDs → explicit match/reset/context-change reasons |
| `setOverrides` / `resetOverrides` | analysis ID + version + declarative operations → validated personal projection |

Validate all DTOs with Zod and share cross-process types under `src/shared/`, matching repository convention. Read endpoints have no provider mutation dependency. Plan generation and progress persistence may be local tRPC mutations; that does not authorize external writes. Pagination cursors are snapshot-bound, opaque and validated. Job ownership is profile/workspace-bound. Start with polling through tRPC to avoid inventing another IPC channel.

Test commands once implemented: run the named Bun test files in `apps/desktop`, then focused type checks and Biome checks for changed files. Run a packaged Electron smoke test for worker/parser resources and immutable diff rendering. Do not execute checked-out PR tests as part of the product analyzer. Integration tests use synthetic repositories, fake providers, isolated DBs and no credential access or network writes. Existing tests are regression anchors; they are not claimed to prove these future behaviors today.

### Rollout, measurement and rollback

Feature flags: `explainableReview` (default off for first release), `reviewGraphEnrichment`, `reviewArchitectureQA`. Begin with local dogfooding and deterministic analysis while users can keep All files as default. Make richer analysis opt-in until budget/quality results are known. Additive DB migration precedes flag activation; existing raw-mode queries remain usable on analysis failure. Turn flags off to roll back without discarding drafts or legacy viewed data. Fix corrupted/incompatible analysis by rebuilding caches, not resetting user progress without notice.

Proposed success criteria, measured against the same PR/task set in counterbalanced guided vs raw sessions:

- At least 80% of participating reviewers correctly identify the principal entry points, one state boundary and a key side effect; improve median comprehension score by 20 percentage points over raw mode.
- At least 95% of “ask → inspect citation → return” tasks restore the intended location without manual search; no composer loss in regression tests.
- Every changed file accounted for; every clickable code citation valid for the displayed snapshot; no silent stale carry-forward or external action from analysis. These are correctness gates, not average metrics.
- Median time to answer architecture questions improves without higher missed-high-severity rate. Test urgent-finding visibility explicitly; do not use review speed or approval rate as the sole success measure.
- Meet measured latency/memory budgets and retain a low-friction raw-mode fallback. Track user reorder/fallback reasons to refine rules rather than “correcting” user preference automatically.

Record content-free local counters/histograms first: tier duration, files/symbols/edges count buckets, partial reason codes, return-restoration success, raw toggle, explicit reviewed/revisit counts, cancellation and cache hit rate. Do not record source, question text, PR title, paths, OIDs or persistent repository identifiers. Current `UsageSnapshot` cannot carry these metrics without a schema/product change [E16]; remote telemetry is optional follow-up, not an implicit implementation dependency. Comprehension itself needs a user study, not inference from clicks.

## Product decisions still open

1. **Default entry experience:** recommended opt-in Flows initially, then per-user remembered preference after evidence; decide whether new reviewers eventually land on flow overview by default.
2. **Inference transport and data disclosure:** choose providers that can enforce the broker contract and decide hosted excerpt consent. Recommended: local structural mode always available; hosted narration optional and off until configured.
3. **Completion semantics:** recommended explicit step-level reviewed state with file-level rollup; confirm whether “understood” wording feels useful or judgmental. Avoid equating review with approval.
4. **Retention:** recommended 30-day inactive cache/conversation retention with active/pinned snapshots exempt, bounded by quota and clear deletion controls; validate user expectations for long-running PRs.
5. **Provider/language launch scope:** recommended GitHub plus local TS/JS flows first, provider-neutral schemas and raw Bitbucket compatibility. Decide whether Bitbucket semantic parity and other language adapters block general availability.
6. **Customization:** recommended private reorder/title overrides first; shared author manifests/export are later, with clear authorship and trust labels.
7. **Severity presentation:** recommended immediate non-modal high/critical security/correctness strip plus unknown-severity availability; validate against users who want findings hidden until the end.

These decisions do not block the snapshot/coverage foundation and deterministic local prototype. Estimates and performance targets need measurement; this investigation does not claim user-study validation or parser accuracy measurements.

## Out of scope

Automatic approval/comment publication, solving/editing PR code, authoring tests on behalf of the reviewed repository, dynamic tracing, running builds or code to infer order, complete cross-language call graphs, whole-monorepo pre-indexing requirements, arbitrary external repository browsing, replacement of existing agents/terminal UX, OAuth redesign, mandatory Graphify, cloud sync of conversations, shared team review state, release/deployment changes, and changing working-tree review semantics. The implementation plan describes future product work; this commit contains documentation only.

## Evidence ledger and reproducibility

All E references below are at `17a316bf5fd73c0c6883128637398aa14bb81c05` unless explicitly marked otherwise. Line ranges are source coordinates, not proposed implementation. Files were read/search-inspected locally; no imported application modules were executed. The repository's `CLAUDE.md` Maintenance convention requires a brief durable index entry for non-obvious findings assembled across files; the companion index entry routes to this plan and existing source only.

| ID | Exact source evidence |
|---|---|
| E01 | `apps/desktop/src/renderer/components/MainContentArea.tsx:67–80`; `components/review-mode/ReviewModeShell.tsx:34–85,329–411`; `components/panes/PaneContent.tsx:78–91` (latter component paths share `apps/desktop/src/renderer/`). |
| E02 | `apps/desktop/src/renderer/components/review-mode/useReviewData.ts:66–111,113–148`; `navigator/ReviewNavigator.tsx:45–90,142–152`; `hooks/useReviewKeymap.ts:83–140` under the same review-mode directory. |
| E03 | `apps/desktop/src/renderer/components/review/ReviewTab.tsx:21–76`; `apps/desktop/src/renderer/lib/working-files.ts`; local commit `98fc524430da01689ac0941039a7160c4b96e18c`, inspected renderer diff and stat. |
| E04 | `apps/desktop/src/shared/github-types.ts:3–12,63–95`; `shared/diff-types.ts:1–24`; `shared/review-types.ts:3–42`; `main/providers/types.ts:19–22,88–94,111–145` under `apps/desktop/src/`. |
| E05 | `apps/desktop/src/renderer/components/review-mode/views/ChangesView.tsx:154–186,412–429`; `apps/desktop/src/main/git/cached-ops.ts:15–59`; `main/git/git-cache.ts:11–38`; `main/trpc/routers/diff.ts:92–125`. |
| E06 | `apps/desktop/src/main/github/github.ts:226–234,419–479,632–655`; `apps/desktop/src/main/providers/github-adapter.ts:184–202`; `apps/desktop/src/main/trpc/routers/projects.ts:61–72`. |
| E07 | `apps/desktop/src/renderer/stores/pr-review-session-store.ts:8–44,78–106,138–183`; `stores/review-mode-store.ts:6–44,65–119`; `lib/review-mode-nav.ts:7–49`; `lib/pr-review-nav.ts:10–18`; `stores/tab-store.ts:849,918,1625`; `components/review-mode/views/ChangesView.tsx:412–429`. |
| E08 | `apps/desktop/src/main/trpc/routers/github.ts:107–161`; `main/db/schema.ts:368–385,567–579`; `main/review/viewed-ops.ts:11–53`; `main/trpc/routers/review.ts:7–33`; `apps/desktop/src/renderer/session-snapshot.ts:12–29,86–145`. |
| E09 | `apps/desktop/src/main/db/schema-ai-review.ts:24–65`; `apps/desktop/src/shared/github-types.ts:31–48`; `apps/desktop/src/renderer/components/review-mode/useReviewData.ts:82–134`; `views/OverviewView.tsx:88–105` under that component directory. |
| E10a | `apps/desktop/src/renderer/components/review-mode/SubmitReviewPopover.tsx:42–52,81–146` (`handleSubmit`, draft and direct branches). |
| E10b | `apps/desktop/src/main/trpc/routers/ai-review.ts:376–396` (`submitReview`). |
| E10c | `apps/desktop/src/main/ai-review/review-publisher.ts:67–125,127–171,174–264` (`publishReview`, provider writes, SQLite updates, verdict gate). |
| E10d | `apps/desktop/src/main/trpc/routers/review.ts:54–68` (direct provider submission); `apps/desktop/src/main/providers/git-provider.ts:3–12` (provider registry and lookup). |
| E11 | `apps/desktop/src/main/ai-review/orchestrator.ts:317–444,475–507`; `main/ai-review/cli-presets.ts:18–67`; `main/db/schema-ai-review.ts:4–18`; `main/control-plane/task-registry.ts:1–43`; `apps/desktop/mcp-standalone/server.mjs:216–299` (review metadata/comment/summary/finish tools). |
| E12 | `apps/desktop/src/main/ai-review/review-workspace.ts:76–92,126–138`; `main/ai-review/commit-poller.ts:9–23,28–54,75–98,127–150`. |
| E13 | `apps/desktop/src/renderer/lsp/monaco-lsp-bridge.ts:141,168,266–305`; `apps/desktop/src/main/trpc/routers/lsp.ts:65–90`; `main/lsp/workspace-symbols.ts:4–13,46–53,77–110`; `main/lsp/ipc-handler.ts:65–99`; `main/lsp/server-manager.ts:15–23`; `main/lsp/trust.ts:10–24`. |
| E14 | `graphify-out/GRAPH_REPORT.md:1–11`; `graphify-out/graph.json` keys `graph`, `nodes`, `links`, relation counts; `graphify-out/manifest.json` timestamp values. These are shared external worktree artifacts, not committed SHA-bound evidence. Search for `graphify`, `callHierarchy`, `call.graph`, `incomingCalls`, `outgoingCalls` under desktop source/tests/MCP found no dedicated product graph service; generic LSP transport is present. |
| E15 | `apps/desktop/src/main/git/workspace-file-root.ts:5–13`; `main/git/file-path.ts:5–36`; `main/git/workspace-file-ops.ts:7–30`; `apps/desktop/src/shared/file-browser-policy.ts:14` excludes graphify output from normal browser traversal. |
| E16 | `apps/desktop/src/shared/telemetry.ts:4–23`; `apps/desktop/src/main/telemetry/snapshot.ts:17–44`. |
| E17 | `apps/desktop/src/main/github/constants.ts:12–14` declares `GITHUB_SCOPES = "repo"`. This is a statement about the checked-in integration, not an audit of live credentials/permissions. |
| E18 | `apps/desktop/src/main/trpc/routers/terminal-files.ts:66–88,128–154`; `main/terminal/daemon-client.ts:124–181,202–236,244–256`; `apps/desktop/src/daemon/terminal-process-identity.ts:5–25`; `apps/desktop/electron.vite.config.ts:99–110`. Historical changed lines are independently verified in H02. |
| E19 | `apps/desktop/src/main/db/index.ts:16–41` (better-sqlite3/Drizzle initialization, automatic migration). Existing generic viewed ops annotate Bun SQLite types [E08]; new production persistence should follow the real main-process DB driver, not copy that annotation blindly. |

History commands used for examples (local, no fetch):

```sh
# H01: focused 30-file slice within the locally recorded PR #129 history
git show --no-patch 68d64d0de17d387ff62583937680ae972a9b01ba
git diff --no-ext-diff --no-textconv --stat 3442ac97315c9a65f9925ce02cd01128b44d76b5 49f2445994a9d6f7193ca3e48d39728bbc32e6a1
git diff --no-ext-diff --no-textconv 3442ac97315c9a65f9925ce02cd01128b44d76b5 49f2445994a9d6f7193ca3e48d39728bbc32e6a1 -- apps/desktop/src/main/ai-review/review-publisher.ts apps/desktop/src/main/trpc/routers/ai-review.ts apps/desktop/src/renderer/components/review-mode/SubmitReviewPopover.tsx
# H02: complete merge-base-to-head comparison for the local PR #161 record
git merge-base 5c3b804069a038670af39a1032cc457bf81d4f0d 22917d06113709b01eaa7ba3bcab4c90f406d878
git diff --no-ext-diff --no-textconv --stat b4a2413f09c5760fa8df6d48d0a16796b24fa15c 22917d06113709b01eaa7ba3bcab4c90f406d878
git diff --no-ext-diff --no-textconv b4a2413f09c5760fa8df6d48d0a16796b24fa15c 22917d06113709b01eaa7ba3bcab4c90f406d878 -- apps/desktop/electron.vite.config.ts apps/desktop/src/main/terminal/daemon-client.ts apps/desktop/src/daemon/terminal-process-identity.ts
```

External primary references consulted 2026-11-10, for proposed primitives only; these do not establish current SuperiorSwarm behavior:

- **W01:** [Git diff options](https://git-scm.com/docs/git-diff): external-diff and text-conversion disabling, merge-base comparison semantics.
- **W02:** [Git object reading](https://git-scm.com/docs/git-cat-file): batch object reads, explicit filters and symlink-following behavior.
- **W03:** [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API): syntax traversal, symbols and custom module resolution host.
- **W04:** [LSP 3.17 call hierarchy specification source](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/language/callHierarchy.md): prepare/incoming/outgoing requests and optional server capability for a future adapter; actual server capabilities and revision isolation still require validation.

## Investigation validation and self-review

Validation completed: local Git inventories confirm H01 has 30 files and H02 has 9; a source-reference check resolved the ledger's file/line citations and found no nonexistent files or out-of-bounds line ranges; `git diff --check` passed before staging. Staging/commit is restricted to this plan and the required `CLAUDE.md` index entry. No product test suite/build is necessary or claimed for a documentation-only investigation. Proposed tests above remain implementation work.

Commit boundary: inspection found a repository `post-commit` hook that rebuilds shared Graphify output even for documentation-only changes. Suppress that post-commit hook for this one commit while retaining any other hooks, and disable signing for this invocation to avoid credential/Keychain access. Do not edit the installed hook, rebuild the shared graph, or change persistent Git configuration. The required index entry is the only documentation change outside this plan.

Using `ecc:agent-self-evaluation`, assessment of this proposal: **4.0/5**. Accuracy 4: baseline and examples are source-pinned, but no running-UI or analyzer benchmark validation. Completeness 4: all ten requested areas covered; inference transport and provider launch scope remain explicit decisions. Clarity 4: contracts and tables separate observations/proposals; long technical sections require the opening recommendation for orientation. Actionability 4: exact file/API/schema/test targets and rollout gates supplied; packaging/parser budgets still need the phase-1 spike. Conciseness 4: evidence ledger is deliberately detailed for auditability, with some repeated path references.

Highest-value next validations: prototype snapshot acquisition and ordering on H01/H02; test return-to-review with users; benchmark parser isolation/packaging before selecting deeper enrichment. These are future implementation/research tasks, not missing authorized work in this planning-only session. Self-check: the user can inspect the recommendation, trace its factual basis and authorize a bounded first phase without accepting a claim that there is one true execution order.
