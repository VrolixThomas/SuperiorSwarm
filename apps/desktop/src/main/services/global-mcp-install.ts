import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliPresetName } from "../../shared/cli-preset";
import type { McpFormat } from "../../shared/mcp-format";
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

function formatForCli(cli: CliPresetName): McpFormat {
	if (cli === "codex") return "toml";
	if (cli === "opencode") return "opencode";
	return "json";
}

function entryFor(format: McpFormat, launcherPath: string): Record<string, unknown> {
	if (format === "opencode") return { type: "local", command: [launcherPath] };
	return { command: launcherPath, args: [] };
}

function keyPathFor(format: McpFormat): string[] {
	if (format === "opencode") return ["mcp", "superiorswarm"];
	if (format === "toml") return ["mcp_servers", "superiorswarm"];
	return ["mcpServers", "superiorswarm"];
}

/** Write the superiorswarm entry into an arbitrary config file in the given format. */
export function installEntryToConfig(
	configPath: string,
	format: McpFormat,
	launcherPath: string
): void {
	const entry = entryFor(format, launcherPath);
	const keyPath = keyPathFor(format);
	if (format === "toml") {
		mergeTomlKey(configPath, keyPath, entry);
	} else {
		mergeKey(configPath, keyPath, entry);
	}
}

/** Remove the superiorswarm entry from an arbitrary config file. No-op if absent. */
export function uninstallEntryFromConfig(configPath: string, format: McpFormat): void {
	if (!existsSync(configPath)) return;
	const keyPath = keyPathFor(format);
	if (format === "toml") {
		removeTomlKey(configPath, keyPath);
	} else {
		removeKey(configPath, keyPath, {
			fileExistedBefore: true,
			dirExistedBefore: true,
		});
	}
}

export function installEntryForCli(
	cli: CliPresetName,
	launcherPath: string,
	opts?: PathOpts
): string {
	const file = cliConfigPaths(cli, opts);
	installEntryToConfig(file, formatForCli(cli), launcherPath);
	return file;
}

export function uninstallEntryForCli(cli: CliPresetName, opts?: PathOpts): void {
	uninstallEntryFromConfig(cliConfigPaths(cli, opts), formatForCli(cli));
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
