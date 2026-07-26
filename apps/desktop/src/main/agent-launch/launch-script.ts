import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliPresetName } from "../../shared/cli-preset";
import { CLI_PRESETS } from "../ai-review/cli-presets";

function escapeShellSingleQuote(s: string): string {
	return s.replace(/'/g, "'\\''");
}

const RESUMABLE: ReadonlySet<CliPresetName> = new Set(["claude", "codex"]);

export function buildAgentLaunchScript(opts: {
	cwd: string;
	cli: CliPresetName;
	prompt: string;
	resumeSessionId?: string;
}): string {
	const preset = CLI_PRESETS[opts.cli];
	if (!preset) throw new Error(`Unknown CLI preset: ${opts.cli}`);
	const prompt = `'${escapeShellSingleQuote(opts.prompt)}'`;
	const flag = preset.permissionFlag ? `${preset.permissionFlag} ` : "";
	let cmd: string;
	if (opts.resumeSessionId) {
		if (!RESUMABLE.has(opts.cli)) throw new Error(`Resume is not supported for ${opts.cli}`);
		const id = `'${escapeShellSingleQuote(opts.resumeSessionId)}'`;
		cmd =
			opts.cli === "claude"
				? `claude --resume ${id} ${flag}${prompt}`
				: `codex resume ${id} ${flag}${prompt}`;
	} else {
		// opencode reserves the positional slot for [project]; `run` delivers the prompt.
		const invocation = opts.cli === "opencode" ? "opencode run" : preset.command;
		cmd = `${invocation} ${flag}${prompt}`;
	}
	return ["#!/bin/bash", `cd '${escapeShellSingleQuote(opts.cwd)}'`, "", cmd, ""].join("\n");
}

export function writeAgentLaunchScript(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "ss-comment-launch-"));
	const scriptPath = join(dir, "launch.sh");
	writeFileSync(scriptPath, content, "utf-8");
	chmodSync(scriptPath, 0o755);
	return scriptPath;
}
