import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentAlert, AgentHookConfig } from "../../../shared/agent-events";
import { mergeAgentSettings } from "./shared";

const EVENT_MAP: Record<string, AgentAlert> = {
	BeforeAgent: "active",
	AfterAgent: "task-complete",
	AfterTool: "active",
};

const HOOK_EVENTS = Object.keys(EVENT_MAP);

export function mergeGeminiHooks(settingsPath: string, hookCommand: string): void {
	mergeAgentSettings(settingsPath, hookCommand, HOOK_EVENTS);
}

export const geminiConfig: AgentHookConfig = {
	name: "gemini",
	hookEvents: HOOK_EVENTS,
	mapEvent(rawEvent: string): AgentAlert | null {
		return EVENT_MAP[rawEvent] ?? null;
	},
	async setup(hookCommand: string): Promise<void> {
		const path = join(homedir(), ".gemini", "settings.json");
		mergeGeminiHooks(path, hookCommand);
	},
};
