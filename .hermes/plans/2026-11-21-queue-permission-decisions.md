# Queue per-request permission channel

Installed evidence: Claude Code 2.1.327; Codex CLI 0.170.0 (`--version`, 2026-11-21). Current primary references: https://code.claude.com/docs/en/hooks#permissionrequest and https://developers.openai.com/codex/hooks (redirects to https://learn.chatgpt.com/docs/hooks).

Both document synchronous PermissionRequest stdout JSON `hookSpecificOutput: {hookEventName: "PermissionRequest", decision: {behavior: "allow" | "deny"}}`. No permission rules, input rewriting or mode changes are needed. Claude explicitly lacks tool_use_id on this event. Codex requires review/trust of exact non-managed hook definitions. Protocol documentation establishes feasibility, not installed live verification.

The bridge creates an unpredictable request UUID for its invocation and holds an authenticated loopback HTTP request. The listener binds it to the exact current entity, terminal, provider, provider conversation and session generation. The queue source receives this UUID, never a guessed later tool ID. A separate receipt secret is never exposed to the renderer. Decisions require current source/group revisions and exact request identity. The one-shot response is consumed only by the original waiting hook. Replays, disconnects, replacements, concurrent ambiguous requests and expired requests cannot be approved. There are no PTY writes.

A 30-second deadline releases normal native approval behavior with no decision. Explicit Open releases the wait immediately without deciding, then navigates. Merely viewing, hovering, typing, waking or selecting a terminal does not decide or dismiss attention; terminal navigation during the bounded wait may briefly show the pending hook. Disabled/legacy listeners and hooks remain telemetry-only and expose unavailable/Open. Capability is granted by a currently bound wait, never by provider name alone.

UI distinguishes sent, bridge stdout receipt, and unknown provider/action outcome. Even a stdout receipt cannot prove provider acceptance, another hook's decision, or command execution. Response loss is uncertain and never automatically retried. No generic activity is used as an approval outcome.

Contract: shared/queue-permissions.ts. Runtime will export getQueuePermissionCapability(item), decideQueuePermission(input). QueuePermissionDecision takes {item, capability, onDecide, onOpen, onChanged?}. A owns router/projection/wiring. The runtime validates exact current queue receipts itself. B can retain ordinary attach-only navigation; explicit permission Open invokes action=open before navigation.

Live verification pending: both provider allow/deny and cancellation/timeout/loss. Stand-in transport and unit evidence will be labeled separately. No global hook trust or approval changes are authorized for tests.
