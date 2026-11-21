import type { AgentEvent } from "../../shared/agent-events";

export interface AgentEventSnapshot {
	version: 2;
	alert: AgentEvent["alert"];
	rawEvent: string | null;
	turnId: string | null;
	retiredTurnIds: string[];
	producerTimestamp: number | null;
}

function readSnapshot(value: unknown): AgentEventSnapshot | null {
	if (!value || typeof value !== "object") return null;
	const row = value as Record<string, unknown>;
	if (
		row["version"] !== 2 ||
		!["active", "needs-input", "task-complete"].includes(String(row["alert"])) ||
		!(row["turnId"] === null || typeof row["turnId"] === "string") ||
		!Array.isArray(row["retiredTurnIds"]) ||
		!row["retiredTurnIds"].every((id) => typeof id === "string") ||
		!(
			row["producerTimestamp"] === null ||
			(typeof row["producerTimestamp"] === "number" && Number.isFinite(row["producerTimestamp"]))
		)
	)
		return null;
	return {
		version: 2,
		alert: row["alert"] as AgentEvent["alert"],
		rawEvent: typeof row["rawEvent"] === "string" ? row["rawEvent"] : null,
		turnId: row["turnId"],
		retiredTurnIds: row["retiredTurnIds"],
		producerTimestamp: row["producerTimestamp"],
	};
}

/** Turn IDs establish identity, not ordering. Arrival time is never a producer clock.
 * Keep a bounded snapshot of retired identities; do not replay an event journal.
 * Legacy hooks without turn/time metadata can only use their arrival sequence.
 */
export function nextAgentEventSnapshot(
	previous: unknown,
	event: AgentEvent
): AgentEventSnapshot | null {
	const before = readSnapshot(previous);
	const producerTimestamp = event.producerTimestamp ?? null;
	if (
		before?.producerTimestamp !== null &&
		before?.producerTimestamp !== undefined &&
		producerTimestamp !== null &&
		producerTimestamp < before.producerTimestamp
	)
		return null;
	if (event.rawEvent?.startsWith("Subagent")) return null;
	if (event.turnId && before?.retiredTurnIds.includes(event.turnId)) return null;
	// A prompt identifies the beginning of a turn, not a generic keep-alive.
	// Its replay after tools or Stop must not clear a later report/input request.
	if (
		event.rawEvent === "UserPromptSubmit" &&
		event.turnId &&
		before?.turnId === event.turnId &&
		before.rawEvent !== "SessionStart"
	)
		return null;
	if (
		(event.rawEvent === "PreCompact" || event.rawEvent === "PostCompact") &&
		before?.alert === "task-complete"
	)
		return null;
	const turnId = event.turnId || before?.turnId || null;
	let retired = before?.retiredTurnIds ?? [];
	if (event.turnId && before?.turnId && event.turnId !== before.turnId) {
		if (retired.includes(event.turnId)) return null;
		// A new prompt establishes a new turn. A newer timed active observation can
		// recover a missed prompt. A foreign Stop cannot establish turn ordering.
		const timedActivity =
			event.alert === "active" &&
			producerTimestamp !== null &&
			(before.producerTimestamp === null || producerTimestamp > before.producerTimestamp);
		if (event.rawEvent !== "UserPromptSubmit" && !timedActivity) return null;
		retired = [...retired, before.turnId].slice(-128);
	} else if (
		event.turnId &&
		before?.turnId === event.turnId &&
		before.alert === "task-complete" &&
		event.alert !== "task-complete" &&
		event.rawEvent !== "UserPromptSubmit" &&
		event.rawEvent !== "WorkspaceContinuation" &&
		!(event.rawEvent === "SessionStart" && event.sessionSource === "resume")
	) {
		// Tool/compaction hooks from a completed turn cannot make it active again.
		return null;
	}
	if (
		event.rawEvent === "SessionStart" &&
		event.sessionSource === "compact" &&
		before?.alert === "task-complete"
	)
		return null;
	return {
		version: 2,
		alert: event.alert,
		rawEvent: event.rawEvent ?? null,
		turnId,
		retiredTurnIds: retired,
		producerTimestamp: producerTimestamp ?? before?.producerTimestamp ?? null,
	};
}
