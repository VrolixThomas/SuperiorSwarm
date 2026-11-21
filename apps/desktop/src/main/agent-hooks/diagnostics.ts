import type { AgentEvent } from "../../shared/agent-events";

interface HookDiagnostic {
	provider: string;
	configuration: "unknown" | "installed" | "failed";
	error: string | null;
	/** Installation is not proof of trust or delivery of every supported event. */
	trust: "review-in-provider" | "provider-controlled";
	lastAcceptedEventAt: number | null;
	lastAcceptedRawEvent: string | null;
	/** Capabilities observed on the last callback, not installation-time promises. */
	lastIdentity: "turn" | "event" | "provider-time" | "legacy-uncertain" | null;
	lastEvidenceFields: string[];
	lastPermissionOutcome: "pending" | "unconfirmed" | "allowed" | "denied" | "cancelled" | null;
}
const diagnostics = new Map<string, HookDiagnostic>();
function get(provider: string): HookDiagnostic {
	return (
		diagnostics.get(provider) ?? {
			provider,
			configuration: "unknown",
			error: null,
			trust: provider === "codex" ? "review-in-provider" : "provider-controlled",
			lastAcceptedEventAt: null,
			lastAcceptedRawEvent: null,
			lastIdentity: null,
			lastEvidenceFields: [],
			lastPermissionOutcome: null,
		}
	);
}
export function recordHookConfiguration(provider: string, error?: string): void {
	diagnostics.set(provider, {
		...get(provider),
		configuration: error ? "failed" : "installed",
		error: error ?? null,
	});
}
export function recordAcceptedHookEvent(event: AgentEvent): void {
	diagnostics.set(event.agent, {
		...get(event.agent),
		lastAcceptedEventAt: event.timestamp,
		lastAcceptedRawEvent: event.rawEvent ?? null,
		lastIdentity: event.turnId
			? "turn"
			: event.providerEventId
				? "event"
				: event.providerTimestamp
					? "provider-time"
					: "legacy-uncertain",
		lastEvidenceFields: (event.evidence ?? []).map((e) => e.sourceField).slice(0, 4),
		lastPermissionOutcome: event.permission?.outcome ?? null,
	});
}
export function getHookDiagnostics(): HookDiagnostic[] {
	return ["claude", "codex", "gemini", "opencode"].map(get);
}
