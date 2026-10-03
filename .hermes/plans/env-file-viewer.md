# Environment files in the right-bar file browser

Status: investigation complete; implementation proposed, not performed.
Date: 2026-10-01. Baseline: `e3799ca6b4fb5221c1130b422cc773893b1d24ad`.
Worktree: `investigate/env-file-viewer`.

## 1. Finding and scope

**Two independent visibility filters cause the bug.** `main/git/file-tree.ts:listAllEntries` removes paths returned by `git.status(["--ignored"])` before sending the listing to the renderer. `RepoFileTree` then defaults `showHidden` to false and removes entries with any dot-prefixed path component. Its filename search uses this already-filtered list. Enabling “Show dotfiles” cannot recover Git-ignored files omitted by the backend.

A separate refresh defect compounds this: repository invalidation events never invalidate `diff.listAllFiles`. These are discoverability failures, not a deliberate `.env` read/write prohibition. The working-tree read/save functions accept `.env` paths and the editor can edit them once opened.

This investigation read `CLAUDE.md` before product exploration, checked for additional repository instructions, and consulted the optional graph report (dated August 15; current source is authoritative). The instruction to update/commit `CLAUDE.md` was overridden by the user's explicit read-only/no-commit boundary. No product files, tests, dependencies, configuration, generated artifacts, Git history, or running app were changed. No real `.env` file, credentials, Keychain item, or user global Git configuration was read. No screenshot or external post was made. This plan is the sole file written.

The existing dependency directories are absent in this worktree. No installation, build, app restart, or repository test suite was attempted. Several existing tests create files and Git commits, so running them would violate this investigation's boundary.

## 2. Exact root-cause evidence

All source paths below are relative to `apps/desktop/src/`, unless explicitly prefixed otherwise. Line references describe the baseline above.

| Evidence | Consequence |
| --- | --- |
| `main/git/file-tree.ts:86–97`, `:111–121`: `listAllEntries`, `git.status(["--ignored"])`, then `if (ignoredPaths.has(relativePath) || ignoredPaths.has(relativePath + "/")) continue` | Ignored files and ignored directory subtrees never reach the renderer. The comment mentioning `check-ignore` is inaccurate: the implementation uses status. |
| Same file `:12–40`: `listDirectory` applies the same ignore test | Changing only the recursive function would leave the sibling API inconsistent. No renderer call to this directory API was found. |
| `renderer/components/RepoFileTree.tsx:920`: `useState(false)` for `showHidden`; `:977–984`: filters every dot-prefixed segment | Root `.env`, nested `.env`, `.env.example`, `.npmrc`, and contents of `.config` are hidden even if Git includes them. |
| Same component `:1005–1011`: `searchFiles(searchQuery, visibleFilePaths)` | Right-bar name search cannot discover filtered files. This search does not examine contents. |
| Same component `:633–637`: eye-button title “Show dotfiles” / “Hide dotfiles” | A real toggle exists, but it only changes renderer filtering and resets on remount. |
| `renderer/hooks/useRepoSubscription.ts:16–53` | Invalidates status/diff/branch queries, never `listAllFiles`, `listDirectory`, or file contents. |
| `renderer/components/RepoFileTree.tsx:946`, `:952–956`, `:1382–1384` | Listing has a 60-second stale time, no polling interval; manual Refresh and successful file mutations invalidate it. Stale time is not a refresh timer. |
| `main/git/file-ops.ts:13–29` | UTF-8 read/write has no dotfile or Git-ignore restriction. Missing/unreadable reads become an empty string. |
| Repository `.gitignore:17–19` | This repository explicitly ignores `.env`, `.env.local`, `.env.*.local`; `.env.development` and `.env.example` are not covered by those rules. This is supporting policy evidence, not evidence that any real secret file exists. |

Git status applies repository/nested `.gitignore`, repository exclude rules, and global excludes. Already tracked files are not excluded just because an ignore pattern matches. Consequently a tracked `.env` may reach the backend listing yet still disappear in the renderer. These are Git semantics, verified against [Git's ignore documentation](https://git-scm.com/docs/gitignore) and [status documentation](https://git-scm.com/docs/git-status); global ignore settings were not inspected locally.

## 3. Shipped flow and owners

1. **Panel and root selection:** `renderer/components/DiffPanel.tsx:DiffPanelContent` mounts `RepoFileTree` only for Files, passing `activeWorkspaceCwd` and `activeWorkspaceId`. `PRControlRail.tsx:1092–1094` instead passes `prCtx.repoPath` with the active workspace ID. Neither should silently substitute the main checkout for a worktree. `tab-store.ts:setActiveWorkspace` maintains the active cwd. `FileTreeNode.tsx:FileTree` is the separate changes/diff tree; it is not the repository browser.
2. **Enumeration:** `main/git/file-tree.ts:listAllEntries` recursively calls `readdir(..., {withFileTypes:true})`, excludes `.git` at every depth, prunes exact status-ignored files/directories, includes empty directories, and returns `{path,type}` entries sorted by full-path `localeCompare`. Only actual regular files/directories are emitted: file links, directory links, broken links and special files are omitted. It does not read file contents. Directory read errors silently drop subtrees; Git errors fall back to an empty ignore set. There is no separate backend dotfile rule. `listDirectory` additionally stats file sizes and rejects lexical traversal in its directory argument.
3. **Contracts:** `main/trpc/routers/diff.ts:200–210,230–235` validates strings with Zod and returns `{entries}`. `shared/types.ts:TrpcAPI` is the generic preload request contract. `renderer/trpc/client.ts` uses inferred `AppRouter` types; `renderer/trpc/ipc-link.ts` calls `window.electron.trpc.request`; `preload/index.ts:90–98` invokes `trpc:request`; `main/trpc/ipc-link.ts:setupTRPCIPC` dispatches with an empty context. There is no per-workspace authorization in these file routes. `FileEntry`/`FlatEntry` currently live in main, and the renderer duplicates the flat type.
4. **Tree and name search:** `RepoFileTree:visibleEntries → buildTree → compactTreeNodes → TreeBranch`. Sorting is directories first, then `name.localeCompare`; no special env sorting. Compact mode defaults on and can combine single-directory chains **and a final single file**, so `nested/.env` can appear as one row. Roots auto-expand once. `searchFiles/fuzzyMatch` is case-insensitive subsequence matching, uses basename unless the query includes `/`, highlights matches, expands ancestors and scrolls through matches; it does not reduce the tree to search hits. No contents or search index are built here.
5. **Virtualization:** none in this browser. `TreeBranch` recursively maps all expanded nodes into DOM rows. `flattenVisible` is for keyboard traversal, not windowing. There is no pagination or explicit enumeration cap. Large newly visible ignored trees therefore require performance validation.
6. **Selection:** click / tree Enter invokes `handleFileSelect` / `openFile(workspaceId,repoPath,path,detectLanguage(path))`. `tab-store.ts:1434` deduplicates within a workspace by root plus relative path. `panes/PaneContent.tsx:69` mounts only the active nonterminal editor, keyed by root/path. Hover, tree expansion and filename matching do not open file contents. Context actions copy paths, reveal in Finder, create, rename or delete; no “send file to agent” action exists in this component.
7. **Reading/editing:** `FileEditor.tsx:106` queries `diff.getFileContent({repoPath,ref:"",filePath})`. That route calls `readWorkingTreeFile`; Git refs use `git.show`. `shared/diff-types.ts:detectLanguage` maps the five requested env filenames to `plaintext`; no env-specific syntax is necessary for editing. Monaco receives full plaintext content after selection. The model snapshots initial content once and ignores subsequent content query refreshes.
8. **Saving:** `FileEditor` schedules `saveFileContent` 500 ms after model changes. The route calls `saveWorkingTreeFile`, which creates parent directories and writes UTF-8. Success invalidates working-tree diff/status, not listing/content. Save errors have no user-visible error state here. Unmount cancels the pending timer without flushing it; switching away before 500 ms can lose the latest edit. These are general editor weaknesses, not the cause of initial env omission.
9. **Watcher/refresh:** `RepoWatcher.start` uses chokidar on resolved Git metadata and the working tree; its 200 ms queue coalesces kinds. It does not use Gitignore or exclude `.env`. It excludes `.git`, `node_modules`, `dist`, `out`, `build`, `.next`, `.cache`, `~`, `.turbo`, `target`, `coverage`, `graphify-out`. `RepoWatcherManager` normalizes roots, shares/refcounts subscriptions, and supports suspend/resume. `main/repo-ipc.ts` forwards `{repoPath,kinds}` through preload `repo:invalidate`, bumps the Git cache version, and refcounts per window. `useRepoSubscription` filters by root but only refreshes Git views. `RepoFileTree` does not subscribe itself; some ancestors do, and the PR branch does not guarantee the tree's own subscription.
10. **Other search:** `SearchEverywherePopup.tsx:90` also consumes `listAllFiles` but has no dotfile filter. Its Files/All searches return names only. Its explicit Text tab calls `diff.searchText` after a two-character, 200 ms debounce. `main/git/search-text.ts:searchText` uses `git grep --untracked --fixed-strings -I`, returns up to 200 line snippets, and has no sensitive-path rule. Symbols use LSP. Do not accidentally change these policies by globally loosening a shared endpoint.
11. **Root limitations:** `file-ops.ts:safeResolve` blocks lexical `..`/absolute escapes but permits the root itself and follows symlink targets when reading/writing. Enumeration omits links, but that is not an IPC access boundary. Routes accept arbitrary `repoPath` strings rather than checking workspace membership. PR root and workspace association must be tested together; a mismatch is a risk, not an observed production root-switch failure.

## 4. Reproduction performed without filesystem writes

A temporary **in-memory fixture workspace** at the synthetic identifier `/virtual/env-file-viewer-fixture` was created in a Node stdin process. There was no on-disk fixture directory. This reconciles the fixture task with the stricter “only the plan may be written” instruction.

The diagnostic read only the identified product source files, used Node v25.2.1 `stripTypeScriptTypes`, evaluated the shipped `listAllEntries`, `listDirectory`, `readWorkingTreeFile`, `saveWorkingTreeFile`, and renderer tree/search functions in an isolated VM, and injected fake `readdir`, `stat`, `readFile`, `writeFile`, and `simpleGit.status` adapters. The `visibleEntries` callback was extracted from the shipped component. All fixture contents were `SYNTHETIC_ONLY=fixture` or `SYNTHETIC_ONLY=edited`. No Bun runtime was launched (avoiding automatic dotenv loading).

Fixture paths: `.env`, `.env.local`, `.env.development`, `.env.example`, `.gitignore`, `.npmrc`, `README.md`, `src/index.ts`, `nested/.env`, `nested/note.txt`, `.config/.env`, `ignored-dir/.env`, `ignored.log`, `global-only.txt`, `node_modules/pkg.js`, `.git/config`; directories plus file, directory, env-named and broken symlink Dirents.

| Executed case | Observed result |
| --- | --- |
| Git reports no ignores | Backend emits all regular fixture files/directories except `.git`; dotfiles-off excludes all env files, `.npmrc`, `.gitignore`, `.config`; dotfiles-on restores them. |
| Git reports `.env`, `.env.local`, `.env.development`, `nested/.env`, `ignored-dir/`, `ignored.log`, `global-only.txt`, `node_modules/` | Backend omits all those entries/subtrees. Turning dotfiles on only finds `.env.example` and `.config/.env` among env files. |
| Git status throws | Backend silently acts as if nothing is ignored. Default renderer still hides dotfiles. This disproves treating the ignore filter as a dependable secret boundary. |
| Filename query `.env` | Zero matches with dotfiles off. With dots on it finds only env names that survived backend enumeration. |
| Symlink Dirents, including `.env.link` | All omitted in both enumeration APIs regardless of hidden toggle; no traversal or target read occurs. |
| Read/save five requested env variants | All round-trip synthetic content successfully through shipped functions using memory adapters. Lexical `../outside.env` is rejected for read and save. |
| Sort sample | `src`, `.env`, `.env.local`, `README.md`: sorting does not explain omission. |
| Content-read spy while enumerating/building/searching | Zero reads. |
| Subscription source assertion | Neither `listAllFiles` nor `listDirectory` appears in the invalidation hook. |

Limitations: Git responses were injected, not produced by a physical repository; the test establishes downstream behavior given those responses, not Git's ignore parsing. No real chokidar event, Electron IPC, React render, Monaco interaction, OS permission check, or symlink race was exercised. Sorting is the local Node locale's result. The ignored-parent result follows the executed skip-before-recursion branch. Do not describe this as an end-to-end GUI reproduction. A later implementation should add physical synthetic Git/worktree fixtures under its own write-authorized test run.

## 5. Intentional protection versus accidental filtering

Repository instructions intentionally prohibit committing env secrets; the Git ignore entries implement that policy. Browser omission conflates Git tracking with local navigation. No env-specific renderer protection or backend read/save denial was found. Ordinary configuration dotfiles are hidden identically, tracked env files evade Git exclusion, and Git failures disable that exclusion. The toggle is a presentation preference, not access control.

A useful IDE convention is to separate browser visibility from Git/search exclusions. VS Code documents `.git` as an Explorer exclusion and makes hiding Git-ignored files a separate `explorer.excludeGitIgnore` option. This supports visible, editable local environment configuration without changing Git rules. See [VS Code Explorer documentation](https://code.visualstudio.com/docs/editing/getting-started/userinterface) and [Microsoft's search exclusions guidance](https://github.com/microsoft/vscode/wiki/Search-Issues). This proposal deliberately retains some noise-directory exclusions rather than promising full VS Code parity.

### Content exposure audit

| Surface | Current evidence / required boundary |
| --- | --- |
| Browser listing/search/hover | Entries contain names/types (directory API also size). No content fetching on browse/search/hover. Preserve this. |
| Git decoration queries | `RepoFileTree` requests `getWorkingTreeStatus`; `main/git/cached-ops.ts:60–83` returns parsed **full diff hunks** for tracked changes even though the tree only needs status. Thus a tracked modified `.env` can reach renderer query memory before opening. Untracked entries have empty hunks. `DiffPanelContent` also subscribes to this status query. This is an existing leak of more data than the browser needs. |
| Editor and caches | Selected content resides in React Query, Monaco and React state (`initialContent`, `previewContent`). QueryClient is in-memory (`renderer/main.tsx`), with no query persistence found. File tabs/session snapshots persist path/language metadata, not editor text (`session-snapshot.ts`). Restoring an active file tab can re-read its contents without a new click; sensitive tabs need explicit reopening. |
| Previews | Requested env variants are plaintext, so no Markdown rendering. Nevertheless preview state is populated for all files. Suffix-based detection can classify `.env.md` as Markdown or `.env.json` as JSON. Prevent this family from entering rendered-preview/LSP paths merely because of a suffix. |
| LSP | `useFileEditorLsp` can send the entire model through `sendDidOpen`/`sendDidChange` when user/trusted-repo configuration supports it. There is no sensitive-path exclusion. `monaco-lsp-bridge.ts:setupServerRestartListener` resends model contents on restart. A hook-only guard is insufficient. Built-in plaintext support is not a security guarantee against custom config. |
| Review overlay | `FileEditor` pushes the full changed content to the active review session whenever **any** review session exists, without root/workspace matching. The in-memory overlay is keyed only by relative path. No direct agent handoff was found, but unrelated review state must not receive env content. |
| Text search/indexing | Right-bar search is names only; there is no browser content index. Explicit global text search can return tracked or non-ignored env lines because `searchText` has no path guard. LSP workspace indexing is a separate process capability. Browser availability must not expand those scopes. |
| Agent prompts | `ai-review/cli-presets.ts:buildReviewPrompt/buildFollowUpPrompt` and `solve-prompt.ts` assemble PR metadata/custom instructions/comments; no dependency on browser entries or editor state was found. Agents can independently read workspace files via their own tools; this investigation does not establish agent sandboxing. Do not wire browser listings/models into agent context. |
| Logs | Renderer IPC link has no logger link. Main IPC logs a procedure-name breadcrumb, not inputs/results. `ipc-safety.ts` logs structural issues, not string values. Watchers log errors, not file contents. Preserve this; do not serialize editor payloads or whole query/mutation errors into diagnostics. |
| Telemetry | `main/telemetry/snapshot.ts:buildSnapshot` contains usage counters/platform/account-provider fields, no file paths or contents. No browser telemetry call was found. Keep new diagnostics aggregate-only. |
| Screenshots | No `capturePage`, `desktopCapturer`, or screenshot implementation was found under `apps/desktop/src`. Open plaintext is naturally visible to user/OS screen capture; hiding tree rows does not prevent that. No screenshot was taken. Never add automatic captures of the editor or use real env contents for screenshots/tests. |

This audit is scoped to the shipped browser and adjacent consumers. It does not certify every third-party process or detect secrets stored under arbitrary filenames.

## 6. Proposed UX and exact filter/sort policy

Recommended design: give the **user-invoked Files browser its own enumeration mode** and make dotfiles visible by default. Do not remove Gitignore rules or globally repurpose the existing enumeration policy.

- Root and nested `.env`, `.env.local`, `.env.development`, `.env.example`, and other `.env*` regular files are visible immediately, including under an otherwise Git-ignored ordinary directory. They open with the same intentional click/Enter action as other files.
- Other dotfiles and dot-directories (e.g. `.gitignore`, `.npmrc`, `.config`) are also visible by default. The existing toggle remains an explicit opt-out, labeled “Show dotfiles,” with checked state and a visible “Dotfiles hidden” indication when off. When off, it hides every dot-prefixed component, including env files; filename search explains that the filter is active.
- Browser mode does **not** use Git ignore status to suppress entries: ordinary ignored files such as `ignored.log` and `global-only.txt` become visible too. Their tracking/ignore status is unchanged. Do not label an ignored file as untracked or imply it will be committed.
- Always omit `.git` as a file or directory, at any depth. Continue omitting symlinks and special files for this release; document that an env symlink is not yet supported. Do not start following symlinks to fix this bug.
- To bound newly included noise and match current watcher coverage, browser mode prunes directories named `node_modules`, `dist`, `out`, `build`, `.next`, `.cache`, `~`, `.turbo`, `target`, `coverage`, `graphify-out` at any depth, plus `.git`. Also omit `.DS_Store` and `Thumbs.db` regular files. These are explicit browser exclusions, not claims that Git always ignores them. A same-named ordinary file is not pruned by a directory rule.
- An env file **inside one of those deliberately excluded directories** remains absent; the browser should expose concise help explaining these exclusions. Changing those directories or adding a “show generated files” mode is a separate feature. This is a documented scope limit, not a hidden `.env` exception.
- Keep directories-first, locale-aware alphabetical sibling sorting, with the literal leading dot participating and a deterministic exact-name tie-breaker. Do not pin, strip dots from, or change the spelling of env names. Preserve canonical relative paths through compaction. Use the same comparator in both enumeration consumers/tree helpers where sibling sorting is required.
- Retain path-only fuzzy search and existing compact-folder behavior. Expanding/selecting/searching must never fetch contents until explicit open. Empty, filtered-empty, inaccessible and failed listing states must be distinct and retain Refresh.
- Show the active workspace/root in accessible browser labeling. Switching roots resets expansion/focus/search state; content and selection must not bleed between identical relative paths in different worktrees.

This broader browser-only ignored-file policy avoids a basename allowlist that still fails when an ancestor is ignored. It deliberately leaves global Search Everywhere's legacy enumeration mode unchanged in the first release.

## 7. Implementation changes and contracts

### A. Explicit browser enumeration

1. Add `shared/file-browser-types.ts`: shared `FileEntry`, `FlatEntry`, `FileListingMode = "git-visible" | "browser"`, and listing warning types. Add `shared/file-browser-policy.ts` for the explicit browser exclusion predicates, sibling comparator, and sensitive-name predicate. Keep visibility predicates separate from content policy.
2. Change `main/git/file-tree.ts:listAllEntries` and `listDirectory` to accept an options argument with `mode`, defaulting to `git-visible` for compatibility. In browser mode use filesystem metadata plus the explicit browser exclusions; skip the Git status call entirely. Preserve the legacy algorithm in the default branch. Share filtering logic between the two APIs and correct the misleading `check-ignore` comment.
3. In `main/trpc/routers/diff.ts:listAllFiles/listDirectory`, add optional validated `mode` to input, default `git-visible`. Preserve `{entries}` and add optional `warnings: [{path,code}]`, with codes `unreadable-directory` or `entry-disappeared`; never put raw errors/content in warnings. Root failures reject; child failures return a partial listing with warnings. Return only root-relative names/types and optional size, never contents or resolved link targets.
4. Move imports to shared types rather than duplicating renderer/main interfaces. No new Electron channel is necessary; the generic preload/tRPC transport and `RepoInvalidateEvent` stay unchanged. Existing callers that omit mode retain behavior. Query keys automatically include the mode; invalidation by `{repoPath}` must cover all modes.
5. `RepoFileTree` explicitly queries `{repoPath,mode:"browser"}`. `SearchEverywherePopup` continues to omit mode. Do not alter Git staging, status membership, ignore files, agent scanning or text-search include rules as a side effect of this endpoint change.

### B. Renderer and root behavior

- In `RepoFileTree`, default `showHidden` true, retain explicit hiding, show hidden/partial/error states, and keep controls mounted even for empty results. Extract pure tree/filter/name-search helpers to `renderer/utils/file-browser.ts` for behavioral tests. Preserve `buildTree`, `compactTreeNodes`, `flattenVisible`, keyboard ordering and relative paths.
- In `DiffPanel` and `PRControlRail`, key the tree by workspace ID plus actual root. Validate the PR root against the active review workspace's registered cwd before making the browser editable; render a root-mismatch message instead of silently editing another checkout.
- Keep `tab-store:openFile` root/path deduplication. Add two-root and two-workspace regression cases; no session schema change is required for basic visibility.
- Do not add virtualization/dependencies for the initial fix. Benchmark 10,000 regular entries and an excluded 100,000-entry dependency subtree, test expanded/compact trees and path search. Enumeration must not enter the dependency subtree. If measured browser rendering misses the release budget (target under one second for the 10,000-entry fixture on the documented test machine), block broad rollout and implement lazy per-directory loading/windowed rows in a separate reviewed increment; never silently truncate env entries to hit a budget.

### C. Refresh and file operations

- Have `RepoFileTree` own `useRepoSubscription(repoPath)` so Files works in both panel hosts. The existing manager supports multiple subscribers; avoid one new watcher per component. Ensure callbacks are installed before/as subscription becomes active and clean up on root change/unmount.
- In `useRepoSubscription`, invalidate `listAllFiles` and `listDirectory` for `working-tree`, `index`, and `head`, scoped to the event root. Keep current status/diff/branch invalidations. Metadata events carry no contents. File create/delete/rename events, including `.env`, then refresh tree names after the existing 200 ms debounce. Index/head cover branch/track-state transitions for the legacy mode.
- Keep the worktree watcher's exclusions aligned with browser exclusions; `.env` and ordinary ignored directories must not be excluded. Explicitly set `followSymlinks:false` to match enumeration's boundary. Do not add watches on user global ignore/credential files. Browser mode does not depend on ignore configuration, so global ignore changes cannot hide its env entries.
- Keep manual Refresh, add an in-progress/failed state, and invalidate both enumeration APIs after successful create/delete/rename. Preserve expansion/focus for surviving paths; move focus predictably after deletion. External save changes do not require re-enumeration of contents.
- Do not replace live Monaco text in response to a list refresh. Fix the editor's pending-save lifecycle with a per-root/path save coordinator: retain the latest dirty text in memory, serialize writes for each file, flush when changing/closing tabs, surface Saving/Saved/Save failed and retry, and clear dirty state only for the acknowledged version. Do not persist secret buffers to disk/localStorage. Prevent an older save completing after a newer one from restoring old text.
- Update/invalidate the exact `getFileContent({repoPath,ref:"",filePath})` cache on successful save. An externally changed open file needs a Reload/Keep editing conflict state, not silent overwrite; compare an on-disk revision returned by a new editor-specific read/save contract (mtime+size alone is advisory; use a content hash/version for save conflict validation). Keep existing diff read semantics for deleted Git-side files. This editor reliability increment is required before claiming reliable env editing, but it is distinct from the visibility root cause.

### D. Content boundaries and scoped file access

1. Define conservative `isSensitiveConfigPath`: case-insensitive basename beginning `.env` (including templates and unusual suffixes), plus exact `.npmrc`, `.pypirc`, `.netrc`. This intentionally over-classifies `.environment`/`.envrc`; it controls automatic content use, **not visibility or explicit local editing**. A filename classifier is not a complete secret detector. `.env.example` receives the same no-automatic-content rule; its name does not prove contents are safe.
2. `FileEditor`: treat this family as plaintext for local editing; do not populate rendered preview state or review optimistic overlays. For nonsensitive files, restrict overlays to the correct workspace/root/review edit pane. Add `workspaceId` through `PaneContent` if needed for that check. Do not attach content to notifications, errors, prompts or telemetry.
3. `useFileEditorLsp` and `monaco-lsp-bridge:sendDidOpen/sendDidChange/setupServerRestartListener`: reject sensitive document synchronization regardless of suffix, trusted-repo configuration, or custom server support. A shared bridge guard also covers reconnects. Verify language features cannot find an unregistered sensitive model through fallback routing. External servers may independently scan disk; this change does not sandbox them.
4. `main/git/search-text.ts:searchText`: add Git pathspec exclusions for sensitive basenames at root and nested levels, then defensively filter returned paths before returning snippets. Test tracked/untracked, case variants and `.env.example`; match the shared predicate, not just `.env`. Keep Git's ordinary ignore behavior. Do not expand content search to browser-mode entries. Searching inside an intentionally opened local editor remains allowed.
5. Remove automatic sensitive hunks from status results before returning/caching them: `cached-ops.ts:getWorkingTreeStatusCached` should obtain name/status metadata for sensitive files and use excluded pathspecs for the hunks query, returning their status with `hunks:[]`. Preserve staging/commit membership. The browser and its `DiffPanel` ancestor must not fetch raw env patches just to decorate a row. Audit other automatically mounted diff/preview queries using the same classifier; user-invoked local file open remains the route to full env contents. Add no new automatic content collector. Broader agent/PR-provider access control is separate scope and must not be represented as solved here.
6. For sensitive file queries, disable background focus/reconnect refetch, avoid retaining inactive query/mutation payloads, and remove caches/model/preview references when the last editor closes (account for two panes viewing one file). In `session-snapshot.ts:serializeLayout`, omit sensitive file tabs and repair `activeTabId` to a remaining tab/null; on hydrate filter old sensitive tabs too. This prevents automatic content reopening from previously persisted sessions while leaving current-session explicit open functional. Normal file session restore remains intact.
7. Add an editor-specific working-tree read route that reports permission/missing/invalid-target errors distinctly rather than translating them into empty content. Preserve existing `getFileContent` behavior for Git diff callers to avoid breaking deleted-file rendering. Return `{content,language,revision}` on success; save accepts `{repoPath,filePath,content,expectedRevision}` and returns `{ok:true,revision}` or a typed conflict. These names/shapes belong in shared types, with content-bearing success used only after explicit editor open.
8. Harden `file-ops:safeResolve` and editor routes: reject empty/root targets and absolute/parent escapes; validate canonical workspace roots; `lstat` each path component and reject symlinks for the first release; open final files with no-follow where supported and revalidate around writes. Validate the nearest existing parent before creation, preserve existing permissions, and use `0600` when intentionally creating sensitive files. Directory enumeration must likewise not traverse a path swapped into a symlink. Test external-root aliases, sibling-prefix attacks and symlinked parents. Node pathname checks alone do not eliminate every adversarial rename race; do not claim an OS sandbox. A race-resistant handle-relative implementation is separate hardening if hostile concurrent filesystem mutation is in scope.
9. In `diff.ts`, validate the provided root against a main-process resolver built from registered workspace/worktree records (new `main/git/workspace-file-root.ts`), rather than trusting a UI cwd or silently using the project root. Route explicit read/save/create/rename/delete through it. Permit registered project-root workspaces and registered review/worktree roots; do not require Git when the registered workspace is a plain folder. Canonicalize roots consistently with watcher/query ownership. Test legitimate callers before enabling enforcement. This security increment may add `workspaceId` to editor-specific routes; existing general diff-ref routes remain separate and need their own authorization audit.

The content safeguards and editor reliability changes are separate implementation increments, with their own tests. They are not evidence that current users' secrets were logged or transmitted, and they should not be folded into an unreviewable one-line hidden-toggle fix.

## 8. Existing coverage and missing coverage

- `tests/diff-save.test.ts`: regular read/write, nonexistent read, intermediate directory creation. No env, ignore, symlink, permission, traversal or concurrent-save cases. Writes a fixed `/tmp/bfx-file-ops-test`, so not run here.
- `tests/repo-watcher.test.ts`: index, tracked working-tree edit, head, refs, debounce and linked-worktree index. Creates fixture repositories/commits. No env create/delete/rename-to-tree-refresh coverage.
- `tests/repo-watcher-manager.test.ts`: sharing, last subscriber close, suspend/resume; retain these lifecycle guarantees.
- `tests/search-text.test.ts`: parser framing/caps, smart case, tracked/untracked text search, dash query, fixture Git repo. No sensitive-file exclusion cases.
- `tests/tab-store.test.ts`: workspace transitions, file opening/deduplication/position and hydration; extend for identical `.env` paths in distinct roots.
- `tests/file-editor-navigation.test.ts` and `tests/use-file-editor-lsp-dismiss.test.ts`: source assertions about navigation/hook behavior, not editor save or privacy integration.
- `tests/search-everywhere-popup.test.ts`: result keys, symbol glyph/empty states; does not cover backend file inclusion.
- `tests/telemetry-snapshot.test.ts`, `tests/ipc-safety.test.ts`, and LSP tests provide adjacent regression coverage.
- No dedicated `file-tree`/`RepoFileTree` enumeration/filter/render test, nor subscription-to-file-list invalidation test, was found in the checked test sources.

## 9. Required test matrix

Use unique temporary fixture roots, synthetic values and isolated Git configuration in the later write-authorized implementation. No actual user env/global-ignore file is needed. Avoid fixtures in a parent repository, and do not reuse the fixed save-test directory.

| Area | Cases and assertions |
| --- | --- |
| Env names | Root and nested `.env`, `.env.local`, `.env.development`, `.env.example`, `.env.test.local`, `.env.md`, `.envrc`; browser default visible, correct relative path, intentional open/edit/save. |
| Dotfiles | `.gitignore`, `.npmrc`, `.config/.env`, hidden directory with normal child, only-dotfile workspace; default visible, explicit toggle hides predictably, filtered-empty message and Refresh remain. |
| Git rules | Tracked, untracked, root ignore, nested ignore, negated `.env.example`, info/exclude, injected global excludes, entire ordinary ignored parent, no Git repo and Git failure. Browser behavior independent; legacy mode remains compatible. |
| Exclusions | `.git` file in a linked worktree and `.git` directory, each explicit generated/dependency directory, same-named regular files, OS noise files; no traversal/read into excluded subtrees. |
| Symlinks | In-root file link, external target, directory link, broken link, cycle, `.env` link, symlinked parent on direct IPC call and replacement during operation; omitted/blocked without reading target. |
| Paths and roots | `..`, absolute path, empty target, root target, sibling-prefix path, Unicode/spaces, two worktrees with same `.env`, PR workspace/root mismatch, registered plain-folder root. Only intended workspace is read/saved. |
| Renderer | Compact on/off, deepest nested match, directories-first sort, locale/tie behavior, click/Enter, hide toggle, match navigation, no content reads on hover/expand/search. |
| Watch/refresh | External create/change/delete/rename `.env`, atomic replacement, ignored ordinary directory, checkout/index event, manual refresh, mutation success, burst coalescing, unsubscribe/root switch, excluded generated trees. Names update without app restart; no cross-root invalidation. |
| Read/save | UTF-8/non-ASCII/comments/newlines/empty file, file permissions, read denied vs empty, save denied, immediate switch/close before 500 ms, overlapping saves, reopened cached file, external-edit conflict. Latest acknowledged content survives; errors are visible without raw values. |
| Privacy | Unique synthetic sentinel absent from listing/status/snippets/LSP notifications+restart/review overlays/telemetry/logs/session snapshots. Explicit editor read/save contains it as expected. Tracked sensitive changes keep status without hunks. No secret contents in screenshot artifacts. |
| Compatibility | `listAllFiles`/`listDirectory` callers without mode unchanged; Search Everywhere name behavior unchanged; Changes tree membership/staging unaffected; deleted Git diff files retain prior empty-side handling. |
| Performance/accessibility | 10k regular files plus excluded huge subtree, rapid refresh, stable focus, screen-reader labels/states, keyboard controls and reduced-motion scrolling. No silent truncation, duplicate watcher or content prefetch. |

Proposed tests: new `tests/file-tree.test.ts`, `tests/repo-file-tree.test.tsx`, `tests/use-repo-subscription.test.tsx`, `tests/file-editor-save.test.tsx`, `tests/file-browser-security.test.ts`; extend the existing files above. Test the actual exported helpers and component behavior rather than copying their implementation. Use mocked Electron at IPC boundaries and real temporary Git fixtures only for Git semantics.

Run targeted Bun tests by directory/file and TypeScript no-emit checks once dependencies exist in the implementation environment; consult the repository's full-suite flakiness warning. Do not treat the in-memory diagnostic from this investigation as a substitute for those tests.

## 10. Accessibility

Give the tree an accessible root/workspace label. Expose selection through `aria-selected` and keyboard focus through roving focus or `aria-activedescendant`; current styling alone is insufficient. Preserve `aria-expanded`, add groups/levels for nested rows, and make compact rows announce the full relative path. Give toolbar icon buttons explicit accessible names and `aria-pressed` for toggles. Announce result counts, active dotfile filtering, refresh failures and save outcomes through restrained live regions. Ensure Enter/Space operate controls, arrow/Home/End navigation is consistent, focus survives refresh, and no sensitive value appears in labels/tooltips/live announcements.

## 11. Migration, rollout and risks

- No DB schema migration or dependency is needed for visibility. The optional enumeration mode is additive; the old mode remains the default. Shared type relocation has no wire-format effect. The editor-specific versioned read/save route is additive and avoids breaking diff callers.
- The hidden toggle currently has no persisted preference to migrate. Default changes to visible on mount; an explicit hide choice is scoped to that mounted workspace. Do not silently reinterpret a future persisted user preference.
- Sensitive session-tab filtering is a deliberate compatibility change: old paths are skipped at hydrate, and future snapshots omit them. Explain that these files must be reopened explicitly; never migrate or persist their contents.
- Browser-mode ignored files can substantially increase filesystem work and DOM size; explicit exclusions and performance tests are release gates. Directory names like `build` can contain hand-authored material; document exclusions and track a separate configurable-browser-exclusions feature.
- Existing silent read/save failures and autosave cancellation make “editable” weaker than “reliably saved.” Do not declare completion based solely on screenshots showing `.env` names.
- Realpath/root enforcement can break legitimate project aliases or review roots unless canonical registration is handled consistently. Keep the symlink non-support explicit and test registered root aliases separately from links inside a root.
- Git failures currently expose otherwise ignored **names** in legacy mode. Browser mode intentionally avoids that unstable dependency. This does not justify broadening text search or agent permissions.
- Deploy the paired backend browser mode and renderer opt-in together. First verify with synthetic local workspaces; then normal release QA. Rollback is restoring the renderer's legacy mode/default-hidden choice, while retaining tested privacy/save protections. Do not add path/content telemetry to measure rollout; use aggregate error/latency counters only if an existing consented mechanism is appropriate.

## 12. Rejected alternatives

1. **Only default `showHidden` to true:** smallest visual change, but ignored `.env` never reaches the client. Fails the common case and does not fix refresh.
2. **Only allow `.env` through the Git filter:** misses variants and descendants of already-pruned ignored directories, retains the renderer filter, and makes secret-path policy depend on brittle name exceptions.
3. **Delete `.env` Gitignore rules / force-add files:** changes source-control safety to fix a local browser problem. Explicitly rejected; Git ignores and commit protection remain intact.
4. **Remove ignores from the existing shared API for every consumer:** silently widens Search Everywhere and future automated consumers and can walk dependency trees. Use explicit browser mode and separate content controls.
5. **Follow all symlinks or crawl all directories to find env files:** introduces cycles/root escape and unbounded traversal. Symlink support needs its own scoped design.
6. **Mask values in the editor or require a warning before every open:** obstructs authorized local editing and does not address backend omission, logs, LSP, or stale listing. Keep explicit local open functional and protect automatic consumers instead.

## 13. Incremental sequence and acceptance criteria

1. Land fixture-backed behavioral tests and shared policy/types first. Establish both current filters, root isolation and negative content-read assertions. No product behavior change yet.
2. Add browser-mode enumeration to both APIs, warnings/errors, and root/symlink protections; retain old mode by default. Validate with physical synthetic Git/worktree fixtures and performance measurements.
3. Add content safeguards (sensitive status hunks, text search, LSP/restart, review overlay, caches/session restore) and the focused editor read/save reliability increment. Keep privacy tests passing before widening visibility.
4. Opt `RepoFileTree` into browser mode, default dots visible, add empty/error/filter/accessibility states and root-keyed lifecycle. Preserve other consumers and changes/staging semantics.
5. Wire file-list invalidation and tree-owned subscriptions; validate create/delete/rename, two roots, and PR hosting without app restart. Run targeted regression/type checks and synthetic GUI QA in the implementation environment.
6. Release only after the criteria below pass; record any remaining external-process limitations rather than claiming a universal secret sandbox.

Acceptance:

- All required regular env variants in normal workspace directories, including ordinary Git-ignored parents, are visible by default and discoverable by right-bar filename search; no toggle, Git rule edit, or restart is needed.
- Explicit hide-dotfiles is reversible and clearly indicated. `.git`, named generated/dependency exclusions, OS noise, symlinks and special files remain excluded as documented; Git ignores continue to protect tracking/commit behavior.
- Click/Enter opens the correct root-relative file; edits reliably save to that root, including quick tab changes, with visible failures/conflicts and no destructive empty-file fallback.
- External structural changes update the correct tree after watcher delivery (target within one second on the fixture); manual Refresh works in empty, error and partial states. No live editor is silently replaced on refresh.
- Browse/search/hover sends only metadata; sensitive contents do not enter automatic status hunks, previews, broad text snippets, LSP/restart, unrelated review state, prompts, logs, telemetry, persisted caches or restored editor tabs. Explicit local open/save remains allowed.
- Existing default enumeration callers, global name-search scope, changes membership and staging behavior stay compatible. No new package or migration is introduced for basic visibility.
- Tests cover root isolation, ignored ancestry, symlinks, watcher refresh, editor persistence, accessibility and performance. The in-memory reproduction is reported honestly as source-level evidence, not live UI verification.
