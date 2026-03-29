// src/shared/agent-events.ts

export type AgentAlert = "active" | "needs-input" | "task-complete";

export interface AgentEvent {
	sessionId: string;
	workspaceId: string;
	alert: AgentAlert;
	agent: string;
	timestamp: number;
}

export const AGENT_NOTIFY_PORT = 27392;

export interface AgentHookConfig {
	/** Identifier for this agent, e.g. "claude" */
	name: string;
	/** Path to the agent's settings file, e.g. ~/.claude/settings.json */
	settingsPath: string;
	/** Hook events to register for in the agent's config */
	hookEvents: string[];
	/** Map a raw agent event name to our alert type. Return null to ignore. */
	mapEvent: (rawEvent: string) => AgentAlert | null;
	/** Register hooks in the agent's config file. Called on app startup. */
	setup: (hookCommand: string) => Promise<void>;
}

/** Registry of all supported agents, keyed by name. Populated by setup.ts. */
export const agentRegistry = new Map<string, AgentHookConfig>();
