// src/main/agent-hooks/setup.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type AgentHookConfig, agentRegistry } from "../../shared/agent-events";
import { claudeConfig } from "./agents/claude";
import { codexConfig } from "./agents/codex";
import { geminiConfig } from "./agents/gemini";
import { opencodeConfig } from "./agents/opencode";

const HOOKS_DIR = join(homedir(), ".agent-notify", "hooks");
const HOOK_SCRIPT_NAME = "on-event.sh";

// Embedded hook script template. Kept inline because Rollup bundles JS only —
// a separate .sh file would not be copied to the build output directory.
const HOOK_TEMPLATE = `#!/bin/bash
# agent-notify hook — called by AI agents to report lifecycle events.
# Generated automatically. Do not edit manually.

# Exit silently if not running inside a terminal with agent-notify.
[ -z "$AGENT_NOTIFY_PORT" ] && exit 0

# Read JSON payload from stdin (Claude Code pipes hook data to stdin).
INPUT=""
if [ ! -t 0 ]; then
\tINPUT=$(cat)
fi

# Also accept a JSON argument (some agents pass as $1).
[ -z "$INPUT" ] && INPUT="\${1:-}"
[ -z "$INPUT" ] && exit 0

# Extract the raw event type. Try "hook_event_name" first (Claude Code), then "type".
EVENT_TYPE=""
EVENT_TYPE=$(echo "$INPUT" | grep -o '"hook_event_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
if [ -z "$EVENT_TYPE" ]; then
\tEVENT_TYPE=$(echo "$INPUT" | grep -o '"type"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"type"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
fi
[ -z "$EVENT_TYPE" ] && exit 0

# Forward raw event to the listener. Server-side mapping handles the rest.
curl -sG \\
\t--connect-timeout 1 \\
\t--max-time 2 \\
\t"http://127.0.0.1:\${AGENT_NOTIFY_PORT}/event" \\
\t--data-urlencode "rawEvent=\${EVENT_TYPE}" \\
\t--data-urlencode "sessionId=\${AGENT_NOTIFY_SESSION_ID:-}" \\
\t--data-urlencode "workspaceId=\${AGENT_NOTIFY_WORKSPACE_ID:-}" \\
\t--data-urlencode "agent=\${AGENT_NOTIFY_AGENT:-unknown}" \\
\t>/dev/null 2>&1 || true

exit 0
`;

function installHookScript(): string {
	if (!existsSync(HOOKS_DIR)) {
		mkdirSync(HOOKS_DIR, { recursive: true });
	}

	const scriptPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
	writeFileSync(scriptPath, HOOK_TEMPLATE, { mode: 0o755 });

	return scriptPath;
}

function buildHookCommand(scriptPath: string, agentName: string): string {
	return `[ -n "$AGENT_NOTIFY_PORT" ] && AGENT_NOTIFY_AGENT="${agentName}" "${scriptPath}" || true`;
}

function installGeminiHookScript(sharedScriptPath: string): string {
	const geminiScript = [
		"#!/bin/bash",
		"# Gemini hook wrapper — outputs required {} JSON before delegating to shared hook.",
		"# Generated automatically. Do not edit manually.",
		"",
		"# Gemini CLI requires immediate JSON output on stdout.",
		"printf '{}\\n'",
		"",
		"# Exit silently if not running inside a terminal with agent-notify.",
		'[ -z "$AGENT_NOTIFY_PORT" ] && exit 0',
		"",
		"# Delegate to the shared hook script (stdin is passed through).",
		`"${sharedScriptPath}" "$@"`,
	].join("\n");

	const scriptPath = join(HOOKS_DIR, "gemini-on-event.sh");
	writeFileSync(scriptPath, geminiScript, { mode: 0o755 });
	return scriptPath;
}

const AGENTS: AgentHookConfig[] = [claudeConfig, codexConfig, geminiConfig, opencodeConfig];

export async function setupAgentHooks(): Promise<void> {
	for (const agent of AGENTS) {
		agentRegistry.set(agent.name, agent);
	}

	try {
		const sharedScriptPath = installHookScript();

		for (const agent of AGENTS) {
			try {
				let scriptPath = sharedScriptPath;
				if (agent.name === "gemini") {
					scriptPath = installGeminiHookScript(sharedScriptPath);
				}
				const hookCommand = buildHookCommand(scriptPath, agent.name);
				await agent.setup(hookCommand);
				console.log(`[agent-hooks] registered hooks for ${agent.name}`);
			} catch (err) {
				console.warn(`[agent-hooks] failed to setup ${agent.name}:`, err);
			}
		}
	} catch (err) {
		console.error("[agent-hooks] failed to install hook script:", err);
	}
}
