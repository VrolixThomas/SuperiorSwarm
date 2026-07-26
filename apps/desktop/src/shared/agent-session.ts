export const AGENT_PROVIDERS = ["claude", "codex", "gemini", "opencode"] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const AGENT_SESSION_STATES = [
	"running",
	"idle",
	"needs-input",
	"hibernating",
	"hibernated",
	"resuming",
	"error",
] as const;

export type AgentSessionState = (typeof AGENT_SESSION_STATES)[number];

export interface AgentSleepSettings {
	enabled: boolean;
	idleMinutes: 5 | 15 | 30 | 60;
	keepOrchestratorsAwake: boolean;
}

export const DEFAULT_AGENT_SLEEP_SETTINGS: AgentSleepSettings = {
	enabled: false,
	idleMinutes: 15,
	keepOrchestratorsAwake: true,
};

export interface AgentSessionInfo {
	terminalId: string;
	workspaceId: string;
	provider: AgentProvider;
	providerSessionId: string | null;
	state: AgentSessionState;
	managed: boolean;
	keepRunning: boolean;
	skipPermissions: boolean;
	lastEventAt: Date | null;
	idleSince: Date | null;
	hibernatedAt: Date | null;
	lastError: string | null;
}

export interface AgentSessionStatusEvent {
	terminalId: string;
	state: AgentSessionState;
	provider: AgentProvider;
	keepRunning: boolean;
	lastError: string | null;
}
