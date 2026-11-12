import type { AgentEvent } from "../../shared/agent-events";

interface HookDiagnostic {
	provider: string;
	configuration: "unknown" | "installed" | "failed";
	error: string | null;
	/** Installation is not proof of trust or delivery of every supported event. */
	trust: "review-in-provider" | "provider-controlled";
	lastAcceptedEventAt: number | null;
	lastAcceptedRawEvent: string | null;
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
	});
}
export function getHookDiagnostics(): HookDiagnostic[] {
	return ["claude", "codex", "gemini", "opencode"].map(get);
}
