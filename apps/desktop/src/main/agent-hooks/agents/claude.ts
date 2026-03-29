import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentAlert, AgentHookConfig } from "../../../shared/agent-events";

const MARKER = "agent-notify";

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

type HookEntry = {
	matcher?: string;
	_marker?: string;
	hooks: Array<{ type: string; command: string }>;
};

export function mergeClaudeHooks(settingsPath: string, hookCommand: string): void {
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

		// Remove any previous agent-notify entries (identified by _marker field)
		const filtered = (existing as HookEntry[]).filter((entry) => entry._marker !== MARKER);

		const hookEntry: HookEntry = TOOL_EVENTS.has(event)
			? {
					matcher: "*",
					_marker: MARKER,
					hooks: [{ type: "command", command: hookCommand }],
				}
			: {
					_marker: MARKER,
					hooks: [{ type: "command", command: hookCommand }],
				};

		filtered.push(hookEntry);
		hooks[event] = filtered;
	}

	settings["hooks"] = hooks;
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, "\t")}\n`);
}

export const claudeConfig: AgentHookConfig = {
	name: "claude",
	settingsPath: "",
	hookEvents: HOOK_EVENTS,
	mapEvent(rawEvent: string): AgentAlert | null {
		return EVENT_MAP[rawEvent] ?? null;
	},
	async setup(hookCommand: string): Promise<void> {
		const path = join(homedir(), ".claude", "settings.json");
		mergeClaudeHooks(path, hookCommand);
	},
};
