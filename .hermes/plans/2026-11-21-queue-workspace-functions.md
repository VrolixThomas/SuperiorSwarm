# Workspace/chat queue functions

User-authorized scope: the four remaining workspace/chat functions. External ticket intake, PR review queues, custom hook queues, and own-ticket/PR feedback stay deferred.

Base: activity-queue at 89894806. Integrate and verify in integration/queue-workspace-functions before merging back. Preserve the user's bun.lock.

## Ownership

- Codex A, feat/queue-direct-conversation-actions: direct conversation reply/resume, exact source/group receipts, daemon admission, reusable action UI and shared router integration.
- Codex B, feat/queue-jump-peek: jump, peek, matching-destination bar, header pending count, keyboard/focus and native navigation tests.
- Codex C, feat/queue-permission-decisions: provider-supported exact request allow/deny, authenticated hook response, expiry/cancellation, actual provider tests.
- Parent: explicit linked ticket/PR context, integration, independent review and retest.

## Acceptance

- Repo workspaces, folders, repo orchestrators and cross-repo coordinators retain exact ownership for Claude and Codex.
- Viewing, jumping, typing, and waking alone never acknowledge an item. Only the exact accepted continuation or explicit dismissal resolves the appropriate occurrence.
- Stale grouped revisions, replaced conversations, busy providers, pending approvals and existing manual drafts cannot receive a queue reply.
- Duplicate/retried/ambiguous sends never silently repeat. Terminal admission, hook receipt, provider acceptance and execution are different evidence levels.
- Permission choices affect exactly one active request; no TUI keystroke approval or global permission-policy changes.
- Context is read-time enrichment. Multiple explicit links survive missing cache; no cross-provider/repo/site confusion or coordinator inheritance. Metadata changes never change source revisions or resurrect Done.
- Jump stops at the end, skips Later, preserves the next item when the current one disappears, and never silently adopts a new occurrence. Peek owns keyboard focus and restores it appropriately.

## Root context evidence

- 7135c80b: explicit local link lookup + shared context contract + readable full/compact component.
- 11ec66f4: read-time projection and source/UI tests.
- Focused DB/projection: 6 pass, 23 assertions. UI: 3 pass, 10 assertions.
- Legacy Jira links have no saved site identity: show reference and missing-details explanation, never infer title/URL from a potentially different site's cache.
- Linear enrichment requires exact global UUID cache identity. PR enrichment uses provider + owner + repository + number, deduplicating explicit review/branch links.
- Shared field, router and full Panel/header integration supplied by A/B; integration build/native verification pending.

## Remaining verification

- Merge owned A/B/C patches, reconcile shared seams, build and compare type diagnostics to clean base.
- Independently rerun meaningful delivery, permission, context and navigation regressions.
- Native window tests run exclusively; actual-provider evidence is recorded separately from stand-ins.
- Hibernated reply/resume requires a proven safe provider/launch channel; old raw shell wake and destroy-all respawn are forbidden fallbacks. Record unsupported capabilities honestly if proof cannot be established.
