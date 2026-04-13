import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentAlert, AgentHookConfig } from "../../../shared/agent-events";

const PLUGIN_DIRS = [
	join(homedir(), ".config", "opencode", "plugins"),
	join(homedir(), "", "hooks", "opencode", "plugin"),
];

// The plugin normalizes OpenCode events to these names before calling on-event.sh
const EVENT_MAP: Record<string, AgentAlert> = {
	Start: "active",
	Stop: "task-complete",
	PermissionRequest: "needs-input",
};

// Built as string array to avoid template literal escaping issues.
// Uses direct HTTP calls instead of the bash script because OpenCode's server
// process doesn't inherit terminal env vars (AGENT_NOTIFY_PORT etc.).
// Port and agent name are hardcoded at generation time.
function buildPluginSource(port: number): string {
	const lines = [
		"// agent-notify plugin for OpenCode",
		"// Generated automatically. Do not edit manually.",
		"",
		"import http from 'node:http';",
		"",
		"export const AgentNotifyPlugin = async () => {",
		"\tif (globalThis.__agentNotifyPluginLoaded) return {};",
		"\tglobalThis.__agentNotifyPluginLoaded = true;",
		"",
		`\tconst PORT = ${port};`,
		'\tlet currentState = "idle";',
		"",
		"\tconst notify = (rawEvent) => {",
		"\t\tconst params = new URLSearchParams({",
		"\t\t\trawEvent,",
		'\t\t\tsessionId: "",',
		'\t\t\tworkspaceId: "",',
		'\t\t\tagent: "opencode",',
		"\t\t});",
		"\t\tconst req = http.get(",
		"\t\t\t`http://127.0.0.1:${PORT}/event?${params.toString()}`,",
		"\t\t\t{ timeout: 2000 },",
		"\t\t\t() => {}",
		"\t\t);",
		"\t\treq.on('error', () => {});",
		"\t\treq.end();",
		"\t};",
		"",
		"\treturn {",
		"\t\tevent: async ({ event }) => {",
		'\t\t\tif (event.type === "session.status") {',
		"\t\t\t\tconst status = event.properties?.status;",
		'\t\t\t\tif (status?.type === "busy" && currentState === "idle") {',
		'\t\t\t\t\tcurrentState = "busy";',
		'\t\t\t\t\tnotify("Start");',
		'\t\t\t\t} else if (status?.type === "idle" && currentState === "busy") {',
		'\t\t\t\t\tcurrentState = "idle";',
		'\t\t\t\t\tnotify("Stop");',
		"\t\t\t\t}",
		"\t\t\t}",
		'\t\t\tif (event.type === "session.busy" && currentState === "idle") {',
		'\t\t\t\tcurrentState = "busy";',
		'\t\t\t\tnotify("Start");',
		"\t\t\t}",
		'\t\t\tif (event.type === "session.idle" && currentState === "busy") {',
		'\t\t\t\tcurrentState = "idle";',
		'\t\t\t\tnotify("Stop");',
		"\t\t\t}",
		'\t\t\tif (event.type === "session.error" && currentState === "busy") {',
		'\t\t\t\tcurrentState = "idle";',
		'\t\t\t\tnotify("Stop");',
		"\t\t\t}",
		"\t\t},",
		'\t\t"permission.ask": async (_permission, output) => {',
		'\t\t\tif (output.status === "ask") {',
		'\t\t\t\tnotify("PermissionRequest");',
		"\t\t\t}",
		"\t\t},",
		"\t};",
		"};",
		"",
	];
	return lines.join("\n");
}

/**
 * Rewrite the generated OpenCode plugin files with an updated port.
 * Called after the listener binds so the plugin targets the actual port
 * (which may differ from the constant if EADDRINUSE forced a fallback).
 */
export function updateOpenCodePluginPort(port: number): void {
	const pluginSource = buildPluginSource(port);
	for (const dir of PLUGIN_DIRS) {
		if (existsSync(dir)) {
			writeFileSync(join(dir, "agent-notify.js"), pluginSource, { mode: 0o644 });
		}
	}
}

export const opencodeConfig: AgentHookConfig = {
	name: "opencode",
	hookEvents: Object.keys(EVENT_MAP),
	mapEvent(rawEvent: string): AgentAlert | null {
		return EVENT_MAP[rawEvent] ?? null;
	},
	async setup(_hookCommand: string): Promise<void> {
		const { AGENT_NOTIFY_PORT } = await import("../../../shared/agent-events");
		const pluginSource = buildPluginSource(AGENT_NOTIFY_PORT);

		for (const dir of PLUGIN_DIRS) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "agent-notify.js"), pluginSource, { mode: 0o644 });
		}
	},
};
