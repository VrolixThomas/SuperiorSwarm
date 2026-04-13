import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentAlert, AgentHookConfig } from "../../../shared/agent-events";
import { mergeAgentSettings } from "./shared";

const EVENT_MAP: Record<string, AgentAlert> = {
	SessionStart: "active",
	Stop: "task-complete",
};

const HOOK_EVENTS = Object.keys(EVENT_MAP);

export function mergeCodexHooks(settingsPath: string, hookCommand: string): void {
	mergeAgentSettings(settingsPath, hookCommand, HOOK_EVENTS);
}

export const codexConfig: AgentHookConfig = {
	name: "codex",
	hookEvents: HOOK_EVENTS,
	mapEvent(rawEvent: string): AgentAlert | null {
		return EVENT_MAP[rawEvent] ?? null;
	},
	async setup(hookCommand: string): Promise<void> {
		const path = join(homedir(), ".codex", "hooks.json");
		mergeCodexHooks(path, hookCommand);
	},
};
