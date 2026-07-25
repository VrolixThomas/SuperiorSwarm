import type { AgentSessionManager } from "./agent-session-manager";

let manager: AgentSessionManager | null = null;

export function setAgentSessionManager(value: AgentSessionManager | null): void {
	manager = value;
}

export function getAgentSessionManager(): AgentSessionManager | null {
	return manager;
}
