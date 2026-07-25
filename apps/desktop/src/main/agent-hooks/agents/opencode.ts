import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	AGENT_NOTIFY_PORT,
	type AgentAlert,
	type AgentHookConfig,
} from "../../../shared/agent-events";

const PLUGIN_DIRS = [join(homedir(), ".config", "opencode", "plugins")];
let pluginAuthToken = "";

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
export function buildOpenCodePluginSource(port: number, authToken: string): string {
	const lines = [
		"// agent-notify plugin for OpenCode",
		"// Generated automatically. Do not edit manually.",
		"",
		"import http from 'node:http';",
		"",
		"export const AgentNotifyPlugin = async ({ directory }) => {",
		"\tif (globalThis.__agentNotifyPluginLoaded) return {};",
		"\tglobalThis.__agentNotifyPluginLoaded = true;",
		"",
		`\tconst PORT = ${port};`,
		`\tconst TOKEN = ${JSON.stringify(authToken)};`,
		"\tconst states = new Map();",
		"",
		"\tconst notify = (rawEvent, sessionID) => {",
		"\t\tconst params = new URLSearchParams({",
		"\t\t\trawEvent,",
		'\t\t\tterminalId: process.env.AGENT_NOTIFY_TERMINAL_ID || process.env.AGENT_NOTIFY_SESSION_ID || "",',
		'\t\t\tproviderSessionId: sessionID || "",',
		'\t\t\tworkspaceId: process.env.AGENT_NOTIFY_WORKSPACE_ID || "",',
		"\t\t\tcwd: directory || process.cwd(),",
		'\t\t\tagent: "opencode",',
		"\t\t});",
		"\t\tconst req = http.get(",
		"\t\t\t`http://127.0.0.1:${PORT}/event?${params.toString()}`,",
		"\t\t\t{ timeout: 2000, headers: { Authorization: `Bearer ${TOKEN}` } },",
		"\t\t\t() => {}",
		"\t\t);",
		"\t\treq.on('error', () => {});",
		"\t\treq.end();",
		"\t};",
		"",
		"\treturn {",
		"\t\tevent: async ({ event }) => {",
		'\t\t\tif (event.type === "session.status") {',
		'\t\t\t\tconst sessionID = event.properties?.sessionID || "";',
		"\t\t\t\tconst status = event.properties?.status;",
		'\t\t\t\tconst previous = states.get(sessionID) || "idle";',
		'\t\t\t\tif (status?.type === "busy" && previous !== "busy") {',
		'\t\t\t\t\tstates.set(sessionID, "busy");',
		'\t\t\t\t\tnotify("Start", sessionID);',
		'\t\t\t\t} else if (status?.type === "idle" && previous !== "idle") {',
		'\t\t\t\t\tstates.set(sessionID, "idle");',
		'\t\t\t\t\tnotify("Stop", sessionID);',
		"\t\t\t\t}",
		"\t\t\t}",
		'\t\t\tif (event.type === "session.idle") {',
		'\t\t\t\tconst sessionID = event.properties?.sessionID || "";',
		'\t\t\t\tif (states.get(sessionID) !== "idle") {',
		'\t\t\t\t\tstates.set(sessionID, "idle");',
		'\t\t\t\t\tnotify("Stop", sessionID);',
		"\t\t\t\t}",
		"\t\t\t}",
		'\t\t\tif (event.type === "session.error") {',
		'\t\t\t\tconst sessionID = event.properties?.sessionID || "";',
		'\t\t\t\tif (states.get(sessionID) === "busy") {',
		'\t\t\t\t\tstates.set(sessionID, "idle");',
		'\t\t\t\t\tnotify("Stop", sessionID);',
		"\t\t\t\t}",
		"\t\t\t}",
		"\t\t},",
		'\t\t"permission.ask": async (permission, output) => {',
		'\t\t\tif (output.status === "ask") {',
		'\t\t\t\tnotify("PermissionRequest", permission?.sessionID || "");',
		"\t\t\t}",
		"\t\t},",
		"\t};",
		"};",
		"",
	];
	return lines.join("\n");
}

export function setOpenCodePluginAuthToken(token: string): void {
	pluginAuthToken = token;
}

/**
 * Rewrite the generated OpenCode plugin files with an updated port.
 * Called after the listener binds so the plugin targets the actual port
 * (which may differ from the constant if EADDRINUSE forced a fallback).
 */
export function updateOpenCodePluginConfig(port: number, authToken = pluginAuthToken): void {
	const pluginSource = buildOpenCodePluginSource(port, authToken);
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
		const pluginSource = buildOpenCodePluginSource(AGENT_NOTIFY_PORT, pluginAuthToken);

		for (const dir of PLUGIN_DIRS) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "agent-notify.js"), pluginSource, { mode: 0o644 });
		}
	},
};
