import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliPresetName } from "../../shared/cli-preset";
import { mergeKey, removeKey } from "../ai-review/mcp-config-merge";
import { mergeTomlKey, removeTomlKey } from "./toml-merge";

interface PathOpts {
	home?: string;
}

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
	opts?: PathOpts,
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
	probe: (cmd: string) => Promise<boolean>,
): Promise<CliPresetName[]> {
	const all: CliPresetName[] = ["claude", "gemini", "codex", "opencode"];
	const found: CliPresetName[] = [];
	for (const cli of all) {
		if (await probe(cli)) found.push(cli);
	}
	return found;
}
