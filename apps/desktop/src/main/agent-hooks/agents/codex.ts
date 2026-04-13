import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentAlert, AgentHookConfig } from "../../../shared/agent-events";

/** Substring used to identify our hook entries by command path. */
const HOOK_FINGERPRINT = ".agent-notify/hooks/";

const EVENT_MAP: Record<string, AgentAlert> = {
	SessionStart: "active",
	Stop: "task-complete",
};

const HOOK_EVENTS = Object.keys(EVENT_MAP);

type HookEntry = {
	hooks: Array<{ type: string; command: string }>;
};

function isAgentNotifyEntry(entry: HookEntry): boolean {
	return entry.hooks?.some((h) => h.command?.includes(HOOK_FINGERPRINT)) ?? false;
}

export function mergeCodexHooks(settingsPath: string, hookCommand: string): void {
	const dir = dirname(settingsPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	let settings: Record<string, unknown> = {};
	if (existsSync(settingsPath)) {
		try {
			settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		} catch {
			settings = {};
		}
	}

	const hooks = (settings["hooks"] ?? {}) as Record<string, unknown[]>;

	for (const event of HOOK_EVENTS) {
		const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
		const filtered = (existing as HookEntry[]).filter((entry) => !isAgentNotifyEntry(entry));

		const hookEntry: HookEntry = {
			hooks: [{ type: "command", command: hookCommand }],
		};

		filtered.push(hookEntry);
		hooks[event] = filtered;
	}

	settings["hooks"] = hooks;
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, "\t")}\n`);
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
