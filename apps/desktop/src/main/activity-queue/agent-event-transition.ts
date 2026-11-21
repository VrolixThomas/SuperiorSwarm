import type { AgentEvent } from "../../shared/agent-events";
import { type AgentEventSnapshot, nextAgentEventSnapshot } from "./agent-event-order";

export interface AgentAttention {
	kind: "agent-input" | "agent-ready";
	summary: string;
	reason: { code: string; label: string };
	evidence: NonNullable<AgentEventSnapshot["evidence"]>;
	permission: AgentEventSnapshot["permission"];
	ordering: NonNullable<AgentEventSnapshot["ordering"]>;
	continuation: NonNullable<AgentEventSnapshot["continuation"]>;
}

/** Call only after exact conversation ownership validation. Null means rejected replay.
 * Use attention (not the raw alert) to build the queue candidate, and fingerprint to
 * version evidence/permission changes even when the high-level alert did not change.
 */
export function transitionAgentEvent(
	previous: unknown,
	event: AgentEvent
): {
	snapshot: AgentEventSnapshot;
	attention: AgentAttention | null;
	fingerprint: string;
	preserveRevision: boolean;
} | null {
	const snapshot = nextAgentEventSnapshot(previous, event);
	if (!snapshot) return null;
	const ordering = snapshot.ordering ?? "uncertain";
	const continuation = snapshot.continuation ?? "none";
	const permission = snapshot.permission ?? null;
	const needsPermission = permission && permission.outcome !== "allowed" && continuation === "none";
	const failed = snapshot.failure ?? snapshot.rawEvent === "StopFailure";
	const uncertain = ordering === "uncertain";
	const label = needsPermission
		? permission.outcome === "pending"
			? "Permission request remains unresolved"
			: `Permission ${permission.outcome}; review the conversation`
		: uncertain
			? "Callback ordering is uncertain; confirm in the conversation"
			: failed
				? "Agent turn failed; needs attention"
				: snapshot.alert === "needs-input"
					? "Agent needs input"
					: "Ready for next input";
	const evidence = snapshot.evidence ?? [];
	const attention: AgentAttention | null =
		snapshot.alert === "active"
			? null
			: {
					kind:
						needsPermission || uncertain || snapshot.alert === "needs-input"
							? "agent-input"
							: "agent-ready",
					summary:
						evidence.find((e) => e.kind === "error" || e.kind === "question" || e.kind === "reply")
							?.text ?? label,
					reason: {
						code: needsPermission
							? "permission-unresolved"
							: uncertain
								? "callback-order-uncertain"
								: failed
									? "turn-failed"
									: snapshot.alert === "needs-input"
										? "session-needs-input"
										: "turn-ended",
						label,
					},
					evidence,
					permission,
					ordering,
					continuation,
				};
	// Delivery uncertainty is diagnostic metadata, not new user work. In particular,
	// it must not invalidate a dismissal receipt, even for older fingerprint formats.
	const semanticFingerprint = (value: AgentEventSnapshot) =>
		JSON.stringify([
			value.alert,
			value.turnId,
			value.failure ?? value.rawEvent === "StopFailure",
			value.evidence ?? [],
			value.permission ?? null,
			value.continuation ?? "none",
		]);
	const fingerprint = semanticFingerprint(snapshot);
	const prior = previous as AgentEventSnapshot | undefined;
	return {
		snapshot,
		attention,
		fingerprint,
		preserveRevision: Boolean(prior?.version === 2 && semanticFingerprint(prior) === fingerprint),
	};
}
