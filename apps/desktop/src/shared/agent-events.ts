// src/shared/agent-events.ts

export type AgentAlert = "active" | "needs-input" | "task-complete";

export interface AgentEvidence {
	kind: "reply" | "question" | "error" | "permission";
	text: string;
	sourceField: string;
	provider: string;
	rawEvent: string;
	truncated: boolean;
	redacted: boolean;
}

export interface AgentPermission {
	requestId?: string;
	outcome: "pending" | "unconfirmed" | "allowed" | "denied" | "cancelled";
}

export interface AgentEvent {
	/** @deprecated Legacy alias for terminalId. */
	sessionId: string;
	terminalId: string;
	providerSessionId: string;
	workspaceId: string;
	cwd: string;
	alert: AgentAlert;
	agent: string;
	/** Listener receipt time; never use it as proof of producer/turn ordering. */
	timestamp: number;
	rawEvent?: string;
	turnId?: string;
	/** Hook bridge invocation time, distinct from listener receipt time. */
	producerTimestamp?: number;
	sessionSource?: string;
	/** Stable provider metadata only; bridge invocation/receipt time is not identity. */
	providerEventId?: string;
	providerTimestamp?: number;
	evidence?: AgentEvidence[];
	permission?: AgentPermission;
}

export const AGENT_NOTIFY_PORT = 27392;

export interface AgentHookConfig {
	/** Identifier for this agent, e.g. "claude" */
	name: string;
	/** Hook events to register for in the agent's config */
	hookEvents: string[];
	/** Map a raw agent event name to our alert type. Return null to ignore. */
	mapEvent: (rawEvent: string) => AgentAlert | null;
	/** Register hooks in the agent's config file. Called on app startup. */
	setup: (hookCommand: string) => Promise<void>;
}

/** Registry of all supported agents, keyed by name. Populated by setup.ts. */
export const agentRegistry = new Map<string, AgentHookConfig>();
