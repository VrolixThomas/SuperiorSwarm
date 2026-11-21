import type { CliPresetName } from "../../shared/cli-preset";

export function quoteShell(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Only fixed executable/flags become shell syntax; user data lives in a prompt file. */
export function buildReviewPathLaunchScript(options: {
	cli: CliPresetName;
	cwd: string;
	promptFile: string;
	taskToken: string;
	skipPermissions: boolean;
}): string {
	const { cli, cwd, promptFile, taskToken, skipPermissions } = options;
	if (cli !== "codex" && cli !== "claude")
		throw new Error(`Reading paths are not supported by ${cli}`);
	const flags = !skipPermissions
		? ""
		: cli === "codex"
			? " -c approval_policy=never -c sandbox_mode=danger-full-access"
			: " --dangerously-skip-permissions";
	return [
		"#!/bin/bash",
		"set -eu",
		`cd -- ${quoteShell(cwd)}`,
		`export SUPERIORSWARM_TASK_TOKEN=${quoteShell(taskToken)}`,
		`exec ${cli}${flags} "$(cat -- ${quoteShell(promptFile)})"`,
		"",
	].join("\n");
}
