import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentAlert, AgentHookConfig } from "../../../shared/agent-events";
import { mergeAgentSettings } from "./shared";

const EVENT_MAP: Record<string, AgentAlert> = {
	UserPromptSubmit: "active",
	PostToolUse: "active",
	PostToolUseFailure: "active",
	Stop: "task-complete",
	PermissionRequest: "needs-input",
};

const HOOK_EVENTS = Object.keys(EVENT_MAP);

// Events that apply to all tools (need matcher: "*")
const TOOL_EVENTS = new Set(["PostToolUse", "PostToolUseFailure", "PermissionRequest"]);

export function mergeClaudeHooks(settingsPath: string, hookCommand: string): void {
	mergeAgentSettings(settingsPath, hookCommand, HOOK_EVENTS, TOOL_EVENTS);
}

export const claudeConfig: AgentHookConfig = {
	name: "claude",
	hookEvents: HOOK_EVENTS,
	mapEvent(rawEvent: string): AgentAlert | null {
		return EVENT_MAP[rawEvent] ?? null;
	},
	async setup(hookCommand: string): Promise<void> {
		const path = join(homedir(), ".claude", "settings.json");
		mergeClaudeHooks(path, hookCommand);
	},
};
