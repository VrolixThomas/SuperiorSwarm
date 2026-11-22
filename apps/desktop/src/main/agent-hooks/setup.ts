// src/main/agent-hooks/setup.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type AgentHookConfig, agentRegistry } from "../../shared/agent-events";
import { log } from "../logger";
import { claudeConfig } from "./agents/claude";
import { codexConfig } from "./agents/codex";
import { geminiConfig } from "./agents/gemini";
import { opencodeConfig, setOpenCodePluginAuthToken } from "./agents/opencode";
import { HOOK_BRIDGE_SOURCE, buildHookLauncher } from "./bridge";
import { recordHookConfiguration } from "./diagnostics";

const HOOKS_DIR = join(homedir(), ".agent-notify", "hooks");
const HOOK_SCRIPT_NAME = "on-event.sh";

function installHookScript(): string {
	if (!existsSync(HOOKS_DIR)) {
		mkdirSync(HOOKS_DIR, { recursive: true });
	}

	const scriptPath = join(HOOKS_DIR, HOOK_SCRIPT_NAME);
	const bridgePath = join(HOOKS_DIR, "on-event.cjs");
	writeFileSync(bridgePath, HOOK_BRIDGE_SOURCE, { mode: 0o644 });
	writeFileSync(scriptPath, buildHookLauncher(bridgePath, process.execPath), { mode: 0o755 });

	return scriptPath;
}

function buildHookCommand(scriptPath: string, agentName: string): string {
	return `[ -n "$AGENT_NOTIFY_TOKEN" ] && AGENT_NOTIFY_AGENT="${agentName}" "${scriptPath}" || true`;
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
		'[ -z "$AGENT_NOTIFY_TOKEN" ] && exit 0',
		"",
		"# Delegate to the shared hook script (stdin is passed through).",
		`"${sharedScriptPath}" "$@"`,
	].join("\n");

	const scriptPath = join(HOOKS_DIR, "gemini-on-event.sh");
	writeFileSync(scriptPath, geminiScript, { mode: 0o755 });
	return scriptPath;
}

const AGENTS: AgentHookConfig[] = [claudeConfig, codexConfig, geminiConfig, opencodeConfig];

export async function setupAgentHooks(agentNotifyToken: string): Promise<void> {
	setOpenCodePluginAuthToken(agentNotifyToken);
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
				recordHookConfiguration(agent.name);
				log.info(`[agent-hooks] installed hook definitions for ${agent.name}`);
				if (agent.name === "codex") {
					log.info(
						"[agent-hooks] Codex delivery requires supported CLI hooks and trust for these exact definitions; review changed hooks with /hooks. Installation does not verify delivery."
					);
				}
			} catch (err) {
				recordHookConfiguration(agent.name, err instanceof Error ? err.message : String(err));
				log.warn(`[agent-hooks] failed to setup ${agent.name}:`, err);
			}
		}
	} catch (err) {
		for (const agent of AGENTS)
			recordHookConfiguration(agent.name, err instanceof Error ? err.message : String(err));
		log.error("[agent-hooks] failed to install hook script:", err);
	}
}
