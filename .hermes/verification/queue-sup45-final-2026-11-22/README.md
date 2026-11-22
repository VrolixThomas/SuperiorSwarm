# SUP-45 final native verification

SUP-45 is complete on the structured app-owned launch path. The implementation was already merged at `cd9d5f28`; this follow-up fixes two fixture defects and verifies automatic registration, repeated resume, direct replies and saved-answer continuation against the final production code.

## Causes of the previously open probes

- `DaemonClient.prepareQueueSleep()` returns an opaque generation string or null. The fixture incorrectly checked `.supported` on that string. Live diagnostics confirmed callback ownership, captured environment and ready input state were already valid. The corrected test also asserts an accepted callback with the actual per-launch nonce.
- Codex 0.170.0 stopped at startup for two unrelated, disabled user hooks whose definitions had changed. Read-only `hooks/list` showed the four synthetic hooks trusted and those two user hooks disabled/modified. The fixture now uses a private temporary `CODEX_HOME`, preserves model settings, and reuses existing file authentication through a temporary symlink. No credentials are read/copied into evidence. Only the four exact synthetic commands receive invocation-local hash trust. User hooks/plugins/MCP settings are not imported; global config and approvals are untouched. Both fixture and parent harness remove the credential link, including parent timeout/crash cleanup.
- One provider response appended a period to the requested marker. The receipt assertion permits that punctuation while still requiring the exact marker in an accepted assistant Stop event; request content, identity and one-shot delivery checks remain exact.

## Results

| Real interactive provider | Empty own chat, two sleep/reply cycles, view-only wake, manual follow-up | Sleeping Send & continue |
| --- | --- | --- |
| Claude | Pass, 17.60s | Pass, 8.61s |
| Codex | Pass, 68.87s | Pass, 13.19s |

The own-chat cases prove first manual input, authentic launch registration, original per-command environment retained across resume, provider-only environment absent from the parked shell, unchanged terminal/conversation identity, sibling-process isolation, repeated same-conversation replies, duplicate request prevention and preserved attention on view-only wake. The answer cases use the rendered production Queue control, public router, native SQLite, daemon admission and actual provider. They prove the exact saved answer is retrieved only after the matching accepted prompt, its question disappears, and a retry does not send twice.

Additional checks: 111 focused backend tests / 770 assertions pass across nine files. Native tests compile fixture main and renderer against production sources and use the rebuilt environment helper. Biome has no errors (existing non-null test warnings remain). Test TypeScript diagnostics decrease from 221 to 220 on the same dependency tree, removing the `.supported` error; no new diagnostics after worktree-path normalization. Repository-wide TypeScript is not clean. Optional Graphify rebuild remains unavailable because the module is missing.

Two Codex peers reviewed the follow-up. Their cleanup findings were addressed, and exact-command hook matching was checked again through the read-only native hook catalog after review. Screenshots and concise results are retained beside this file; the manifest identifies full private native traces. All final fixture credential links were verified removed.

## Evidence boundaries and supported fallbacks

These probes register launches through the production manager and execute controlled native provider argv. They prove callback → registration → admission → real provider continuation; they do not click the public New Chat menu. That menu/create ordering and repo/folder/orchestrator ownership are separately covered in the own-chat launch tests and native menu evidence. The public answer-router matrix covers both providers across repo/worktree, folder, repository orchestrator and coordinator using controlled lifecycle seams. This final native run is not a live-provider Cartesian matrix across all entity kinds.

Question records in the live answer cases are controlled seeds bound to the real provider conversation, not questions autonomously created through MCP. Unknown/legacy launch provenance, complete daemon loss, missing native environment inspection, ambiguous questions and oversized answers retain Open/Save-only recovery. This fixture requires standard Codex provider/file authentication; it does not generalize custom credential stores. No production guard was relaxed, user chat changed, push or release performed.

## Reproduce

Run from `apps/desktop` after building, with exclusive GUI ownership:

```sh
SS_QUEUE_REPLY_TUI=1 SS_QUEUE_RESUME_TUI=1 SS_QUEUE_EMPTY_CHAT_TUI=1 SS_QUEUE_NATIVE_CASES=codex bun test tests/queue-reply-tui.test.ts
SS_QUEUE_REPLY_TUI=1 SS_QUEUE_RESUME_TUI=1 SS_QUEUE_EMPTY_CHAT_TUI=1 SS_QUEUE_NATIVE_CASES=claude SS_QUEUE_TRUSTED_CWD=/path/to/already-trusted/checkout bun test tests/queue-reply-tui.test.ts
```

For each provider's saved-answer case, replace `SS_QUEUE_EMPTY_CHAT_TUI=1` with `SS_QUEUE_ANSWER_TUI=1`. Claude keeps its native plan policy/tools disabled; Codex keeps read-only/on-request. Neither uses approval or hook-trust bypass flags.
