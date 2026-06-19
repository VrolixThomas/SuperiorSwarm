import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliPresetName } from "../../shared/cli-preset";
import { mergeKey, removeKey } from "../ai-review/mcp-config-merge";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { mergeTomlKey, removeTomlKey } from "./toml-merge";

interface PathOpts {
	home?: string;
}

const ALL_CLIS: CliPresetName[] = ["claude", "gemini", "codex", "opencode"];

function h(opts?: PathOpts): string {
	return opts?.home ?? homedir();
}

export function cliConfigPaths(cli: CliPresetName, opts?: PathOpts): string {
	switch (cli) {
		case "claude":
			return join(h(opts), ".claude.json");
		case "gemini":
			return join(h(opts), ".gemini", "settings.json");
		case "codex":
			return join(h(opts), ".codex", "config.toml");
		case "opencode":
			return join(h(opts), ".config", "opencode", "opencode.json");
	}
}

function buildEntry(cli: CliPresetName, launcherPath: string): Record<string, unknown> {
	if (cli === "opencode") {
		return { type: "local", command: [launcherPath] };
	}
	return { command: launcherPath, args: [] };
}

function keyPath(cli: CliPresetName): string[] {
	if (cli === "opencode") return ["mcp", "superiorswarm"];
	if (cli === "codex") return ["mcp_servers", "superiorswarm"];
	return ["mcpServers", "superiorswarm"];
}

export function installEntryForCli(
	cli: CliPresetName,
	launcherPath: string,
	opts?: PathOpts
): string {
	const file = cliConfigPaths(cli, opts);
	const entry = buildEntry(cli, launcherPath);
	if (cli === "codex") {
		mergeTomlKey(file, keyPath(cli), entry);
	} else {
		mergeKey(file, keyPath(cli), entry);
	}
	return file;
}

export function uninstallEntryForCli(cli: CliPresetName, opts?: PathOpts): void {
	const file = cliConfigPaths(cli, opts);
	if (!existsSync(file)) return;
	if (cli === "codex") {
		removeTomlKey(file, keyPath(cli));
	} else {
		removeKey(file, keyPath(cli), { fileExistedBefore: true, dirExistedBefore: true });
	}
}

export async function detectInstalledClis(
	probe: (cmd: string) => Promise<boolean>
): Promise<CliPresetName[]> {
	// Probe in parallel — each probe can wait up to the shell timeout, so running
	// them serially would stack those timeouts on every app startup.
	const results = await Promise.all(ALL_CLIS.map(async (cli) => ((await probe(cli)) ? cli : null)));
	return results.filter((c): c is CliPresetName => c !== null);
}

/**
 * Register the superiorswarm MCP for every CLI that is actually installed on the
 * user's machine. We only write into detected CLIs — writing into undetected
 * ones would scatter config files (~/.codex, ~/.gemini, ...) for tools the user
 * never uses. Reliable detection is therefore on the probe (see cli-probe.ts).
 */
export async function runGlobalMcpInstall(
	launcherPath: string,
	probe: (cmd: string) => Promise<boolean>
): Promise<CliPresetName[]> {
	const detected = await detectInstalledClis(probe);
	const db = getDb();
	const now = new Date();
	for (const cli of detected) {
		const configPath = installEntryForCli(cli, launcherPath);
		db.insert(schema.globalMcpInstall)
			.values({ cliPreset: cli, configPath, installedAt: now })
			.onConflictDoUpdate({
				target: schema.globalMcpInstall.cliPreset,
				set: { configPath, installedAt: now },
			})
			.run();
	}
	return detected;
}
