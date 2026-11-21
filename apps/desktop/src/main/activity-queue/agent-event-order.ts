import type { AgentEvent, AgentEvidence, AgentPermission } from "../../shared/agent-events";
import { validateAgentEvidence } from "../../shared/agent-evidence";

export interface AgentEventSnapshot {
	version: 2;
	alert: AgentEvent["alert"];
	rawEvent: string | null;
	turnId: string | null;
	retiredTurnIds: string[];
	/** Compatibility only: bridge invocation time is never an ordering clock. */
	producerTimestamp: number | null;
	providerTimestamp?: number | null;
	seenEventIds?: string[];
	evidence?: AgentEvidence[];
	permission?: AgentPermission | null;
	ordering?: "identified" | "uncertain";
	continuation?: "none" | "prompt" | "reported";
}

function readSnapshot(value: unknown): AgentEventSnapshot | null {
	if (!value || typeof value !== "object") return null;
	const row = value as AgentEventSnapshot;
	if (
		row.version !== 2 ||
		!["active", "needs-input", "task-complete"].includes(row.alert) ||
		!(row.turnId === null || typeof row.turnId === "string") ||
		!Array.isArray(row.retiredTurnIds) ||
		!row.retiredTurnIds.every((id) => typeof id === "string")
	)
		return null;
	return row;
}

/** Stable turn/event identity and provider clocks are evidence. Invocation time is not.
 * Untagged legacy traffic cannot silently clear attention or establish a fresh completion.
 * Keep uncertainty visible until an identified prompt or explicit bound continuation arrives.
 */
export function nextAgentEventSnapshot(
	previous: unknown,
	event: AgentEvent
): AgentEventSnapshot | null {
	const before = readSnapshot(previous);
	const providerTimestamp = event.providerTimestamp ?? null;
	if (event.rawEvent?.startsWith("Subagent")) return null;
	if (event.providerEventId && before?.seenEventIds?.includes(event.providerEventId)) return null;
	if (
		providerTimestamp !== null &&
		before?.providerTimestamp != null &&
		providerTimestamp < before.providerTimestamp
	)
		return null;
	if (event.turnId && before?.retiredTurnIds.includes(event.turnId)) return null;
	const reported = event.rawEvent === "WorkspaceContinuation";
	const prompt = event.rawEvent === "UserPromptSubmit";
	const stable = Boolean(event.turnId || event.providerEventId || providerTimestamp !== null);
	if (
		prompt &&
		event.turnId &&
		before?.turnId === event.turnId &&
		before.rawEvent !== "SessionStart"
	)
		return null;
	if (event.rawEvent === "SessionStart" && event.sessionSource === "resume" && before)
		return before;
	if (["PreCompact", "PostCompact"].includes(event.rawEvent ?? "") && before) return null;
	if (event.rawEvent === "SessionStart" && event.sessionSource === "compact" && before) return null;
	// A missing turn cannot be assigned to the most recently observed turn. In particular,
	// it cannot clear a newer report merely because the bridge ran again later.
	if (before && !event.turnId && !reported) {
		return { ...before, ordering: "uncertain" };
	}
	let retired = before?.retiredTurnIds ?? [];
	if (event.turnId && before?.turnId && event.turnId !== before.turnId) {
		// New turn identity alone does not order a foreign Stop/tool against current work.
		if (!prompt) return null;
		retired = [...retired, before.turnId].slice(-128);
	} else if (
		before?.alert === "task-complete" &&
		event.alert === "active" &&
		!prompt &&
		!reported
	) {
		return null;
	}
	let permission =
		event.rawEvent === "PermissionRequest"
			? (event.permission ?? { outcome: "pending" as const })
			: (event.permission ?? before?.permission ?? null);
	const continuation =
		event.rawEvent === "PermissionRequest"
			? "none"
			: reported
				? "reported"
				: prompt
					? "prompt"
					: (before?.continuation ?? "none");
	// Only an explicitly correlated outcome can resolve a pending request. Tool execution,
	// tool failure, Stop, and an unrelated request ID provide no such proof.
	if (
		event.permission &&
		event.permission.outcome !== "pending" &&
		(!event.permission.requestId || event.permission.requestId !== before?.permission?.requestId)
	) {
		permission = before?.permission ?? null;
	}
	if (event.rawEvent === "PermissionRequest" && !permission) permission = { outcome: "pending" };
	let alert = event.alert;
	if (permission && permission.outcome !== "allowed" && continuation === "none")
		alert = "needs-input";
	// Generic tool activity is not an answer to an outstanding question/failure.
	if (
		before?.alert === "needs-input" &&
		event.alert === "active" &&
		!prompt &&
		!reported &&
		!(event.permission?.outcome === "allowed" && permission?.outcome === "allowed")
	)
		alert = "needs-input";
	const incomingEvidence = validateAgentEvidence(event.evidence, event.agent, event.rawEvent ?? "");
	const evidence = incomingEvidence.length ? incomingEvidence : (before?.evidence ?? []);
	// Keep request text beside the eventual reply/error. Never overwrite unresolved context.
	const retained =
		permission && continuation === "none"
			? (before?.evidence ?? []).filter((e) => e.kind === "permission")
			: [];
	return {
		version: 2,
		alert,
		rawEvent: event.rawEvent ?? null,
		turnId: event.turnId || (reported ? null : before?.turnId) || null,
		retiredTurnIds: reported && before?.turnId ? [...retired, before.turnId].slice(-128) : retired,
		producerTimestamp: event.producerTimestamp ?? before?.producerTimestamp ?? null,
		providerTimestamp: providerTimestamp ?? before?.providerTimestamp ?? null,
		seenEventIds: event.providerEventId
			? [...(before?.seenEventIds ?? []), event.providerEventId].slice(-128)
			: (before?.seenEventIds ?? []),
		evidence:
			prompt || reported
				? []
				: [
						...retained,
						...evidence.filter((e) => !retained.some((r) => r.sourceField === e.sourceField)),
					]
						.slice(0, 4)
						.map((entry) => ({
							...entry,
							text: entry.text.slice(0, 1024),
							truncated: entry.truncated || entry.text.length > 1024,
						})),
		permission,
		ordering: stable || reported ? "identified" : "uncertain",
		continuation,
	};
}
