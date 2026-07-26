export interface AgentSessionInfo {
	cli: "claude" | "codex";
	sessionId: string;
	label: string;
	lastActiveAt: number;
}
