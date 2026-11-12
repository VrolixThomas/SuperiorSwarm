import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Substring used to identify our hook entries by command path. */
const HOOK_FINGERPRINT = ".agent-notify/hooks/";

export type HookEntry = {
	matcher?: string;
	hooks: Array<{ type: string; command: string }>;
};

/** Check if a hook entry is one of ours by inspecting the command path. */
function isAgentNotifyEntry(entry: HookEntry): boolean {
	return entry.hooks?.some((h) => h.command?.includes(HOOK_FINGERPRINT)) ?? false;
}

/**
 * Read a JSON settings file, replace any previous agent-notify hook entries
 * for the given events, and write it back.
 */
export function mergeAgentSettings(
	settingsPath: string,
	hookCommand: string,
	hookEvents: string[],
	toolEvents?: Set<string>
): void {
	const dir = dirname(settingsPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	let settings: Record<string, unknown> = {};
	if (existsSync(settingsPath)) {
		const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("Hook settings must be a JSON object; existing file was preserved");
		settings = parsed as Record<string, unknown>;
	}

	const existingHooks = settings["hooks"];
	if (
		existingHooks !== undefined &&
		(!existingHooks || typeof existingHooks !== "object" || Array.isArray(existingHooks))
	)
		throw new Error("Hook settings.hooks must be an object; existing file was preserved");
	const hooks = (existingHooks ?? {}) as Record<string, unknown[]>;

	for (const event of hookEvents) {
		const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
		const filtered = (existing as HookEntry[]).filter((entry) => !isAgentNotifyEntry(entry));

		const hookEntry: HookEntry = toolEvents?.has(event)
			? {
					matcher: "*",
					hooks: [{ type: "command", command: hookCommand }],
				}
			: {
					hooks: [{ type: "command", command: hookCommand }],
				};

		filtered.push(hookEntry);
		hooks[event] = filtered;
	}

	settings["hooks"] = hooks;
	const content = `${JSON.stringify(settings, null, "\t")}\n`;
	if (!existsSync(settingsPath) || readFileSync(settingsPath, "utf-8") !== content)
		writeFileSync(settingsPath, content);
}
