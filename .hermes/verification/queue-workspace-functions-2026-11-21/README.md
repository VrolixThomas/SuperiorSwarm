# Workspace/chat queue integration — 2026-11-21

Implemented and independently checked in `integration/queue-workspace-functions`, based on `activity-queue@89894806`, for merge into `activity-queue`. Three SuperiorSwarm workers used Codex; the parent implemented linked context and reviewed/integrated all lanes.

This is a tested supported-path delivery. **Automatic resume of sleeping chats and automatic Send-and-continue after saving a structured inbox answer remain open.** External ticket/PR/hook/own-feedback intake remains deferred.

## Delivered behavior

- Direct replies to eligible live Claude/Codex chats, with exact entity, terminal, provider conversation and full displayed source receipts. Messages are trimmed and limited to 4,000 characters. Provider slash commands and shell shortcuts require opening the chat.
- Read-only availability checks; causal prompt/idle and input accounting; rejection of drafts, queued input, busy/replaced/unverified processes, new questions/permissions and changed grouped receipts. Native SQLite takes an IMMEDIATE write reservation before the final validation and handoff.
- Durable duplicate prevention and honest admitted/uncertain/received stages. Checking an uncertain delivery is read-only, even when its original request never reached the server. Only a matching exact-conversation provider prompt digest establishes received; it does not prove work completion.
- Cleanup protects newer reports from delayed queued-input callbacks. A missing digest can protect one turn, but cannot prevent later manual follow-ups from cleaning normally forever. Viewing, typing, navigation and mere wake-up do not acknowledge work.
- Cmd/Ctrl+J jump, Cmd/Ctrl+Shift+J peek, a compact matching-chat queue bar, workspace pending counts, and linked ticket/PR context. Navigation stops at the end, skips Later and does not skip the shifted successor after cleanup. Receipt changes require explicit selection.
- Per-request permission Allow once/Deny over a supported authenticated hook channel. Incomplete/redacted action details disable Allow. Controls expire without requiring a source revision. Open releases the wait without deciding or dismissing.
- Permission waits apply only to an exact conversation known to be hidden. Already-visible/unknown terminals keep their native prompt; visibility handoff releases an existing wait. Fresh managed dispatch uses a first-generation admission lease; replacement cannot inherit hidden status.
- Context uses explicit links only. Multiple links are retained; metadata changes never revise sources or resurrect Done. A legacy Jira link without saved site identity shows the reference and missing-context explanation instead of borrowing another site's cached title.

## Verification and limits

| Check | Evidence |
| --- | --- |
| Parent combined source/UI/native-Node regressions | 220 pass across 25 files; [file list](source-test-files.txt), [log](source-tests.log). |
| Additional reply boundary/admission/UI checks | 38 pass, including 4,001-character rejection, exact trimmed boundary and no terminal write on rejection; [log](reply-boundary-tests.log). |
| Keyboard actions | 24 pass, including scoped R, Enter, Shift+Enter, IME/modifier/repeat guards; [log](keyboard-tests.log). |
| Last defensive/type-only changes | 20 pass; [log](last-fixes.log). |
| Production permission UI/router vertical | Native Electron + real preload, public activityQueue router, connected QueueItemActions, SQLite, daemon socket/PTY and actual bridge, with provider stand-ins. Exact decisions, sibling isolation, stable-receipt capability refresh and visibility fallback pass. [Result](public-permission-native.json), [image](public-permission-native.png), [log](public-permission-native.log). |
| Parent native full-shell navigation | Pass, 39.98s total. Actual MainContentArea/MainLayout/Sidebar/xterm, compact/narrow/wide geometry, header links, focus, grouped Done/Undo/Later, inbox ownership, zero replacement creates and zero PTY writes. Provider state is a stand-in. [Log](navigation-native.log); [lane screenshots and detailed assertions](../queue-jump-peek-2026-11-21/README.md). |
| Actual interactive providers | Claude and Codex each accepted the Queue reply in the same conversation, produced the expected new assistant response, and rejected duplicate sending. DOM controls and a minimal terminal protocol responder are fixture seams; this is not physical-keyboard or whole-installed-app bootstrap proof. [Detailed report/results](../queue-direct-replies-2026-11-21/README.md). |
| Actual permission providers | Seven Claude and seven Codex CLI cases: allow, deny, Open, timeout, cancellation, stale request and response loss. Exact invocation-only synthetic hook trust, no global policy bypass. [Detailed report/results](../queue-permission-decisions-2026-11-21/README.md). |
| Entity/provider combinations | Controlled production DB/daemon/service tests cover both providers across repo/worktree, folder, repository orchestrator and cross-repository coordinator, including siblings and cold managed dispatch. These are composed with the actual-provider tests, not a claim of every full live Cartesian combination. |
| Build and static checks | Production build and final main/daemon rebuild pass. Biome has no errors; non-null assertion/test warnings remain. [Build](build.log), [Biome](biome.log), [type comparison](type-comparison.json). |

The first parent navigation rerun exhausted its 90s outer test budget during Vite bundling under system load (load average about 42). Only the outer bundling budget increased to 300s; the native child retains its 60s timeout and all assertions. The subsequent full run passed. [Original timeout](native-build-timeout.log).

Type checking is not globally clean. Main retains 61 baseline diagnostics and renderer 81. The new full-shell native fixture makes 12 already-existing renderer diagnostics visible to the tests configuration as well (204 baseline → 216); no novel diagnostics remain after the test-only fixes. See the comparison JSON.

## Remaining work

1. Safe same-conversation hibernated resume needs a structured launch/admission protocol. The existing raw shell wake and destroy-all-terminal fallback are not used by queue replies.
2. Saved structured answers retain saved/retrieved semantics; automatic wake/continue after saving remains absent.
3. Live success cases do not establish real provider API-error UI, full process restart/hibernation or externally concurrent provider submissions. Unsupported platforms, legacy daemons, unobserved generations and ambiguous input expose Open.
4. One attempt to resume the finished Codex permission worker through the currently running SuperiorSwarm MCP returned `resume_not_supported`; the parent completed its small expiry follow-up locally. This is not claimed as a successful installed-app resume test. The user's request to leave the concurrent installed/dev ownership situation unchanged was respected.

The original user's bun.lock is preserved. No push or release is part of this integration.
