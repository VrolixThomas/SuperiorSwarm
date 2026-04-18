import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { app } from "electron";
import { CLI_PRESETS } from "../ai-review/cli-presets";
import { getDb } from "../db";
import * as schema from "../db/schema";

export interface LaunchInstallAgentOptions {
	repoPath: string;
	configId: string;
	displayName: string;
	candidateBinaries: string[];
	customPrompt?: string;
}

export interface LaunchInstallAgentResult {
	launchScript: string;
	promptFilePath: string;
	repoPath: string;
}

export interface BuildInstallPromptOptions {
	repoPath: string;
	configId: string;
	displayName: string;
	candidateBinaries: string[];
}

function getCliPreset(): schema.AiReviewSettings {
	const db = getDb();
	const existing = db
		.select()
		.from(schema.aiReviewSettings)
		.where(eq(schema.aiReviewSettings.id, "default"))
		.get();
	if (existing) return existing;

	const inserted = db
		.insert(schema.aiReviewSettings)
		.values({
			id: "default",
			cliPreset: "claude",
			autoReviewEnabled: 0,
			skipPermissions: 1,
			maxConcurrentReviews: 3,
			updatedAt: new Date(),
		})
		.returning()
		.get();
	if (!inserted) throw new Error("Failed to seed default AI review settings");
	return inserted;
}

export function buildInstallPrompt(opts: BuildInstallPromptOptions): string {
	const binariesLine = opts.candidateBinaries.join(", ");
	return `The user opened a ${opts.displayName} file in SuperiorSwarm and wants a language server for "${opts.configId}", but no binary was found on PATH.

Known candidate binaries: ${binariesLine}
Repository: ${opts.repoPath}

Your task:
1. Detect which package managers are available on this machine (brew, apt, dnf, pacman, npm, cargo, pip, pipx, go, gem, nix, mise, asdf, winget — whichever apply to the user's OS).
2. Ask the user which install method they prefer. Do NOT assume — present 2 or 3 concrete options with the exact command they would run.
3. Only after the user picks, run the chosen install under the normal permission flow.
4. Verify the install succeeded by running the binary with \`--version\` (or the closest equivalent) and showing the output.
5. Report back in one short paragraph: the binary name, the full resolved path (\`which <binary>\`), and the version.

Rules:
- Never run a destructive command without confirming.
- Never edit repository files — this is an install task only.
- If an install fails, surface the exact error and ask the user how to proceed.`;
}

export async function launchInstallAgent(
	opts: LaunchInstallAgentOptions
): Promise<LaunchInstallAgentResult> {
	const sessionId = randomUUID();
	const sessionDir = join(app.getPath("userData"), "lsp-install", sessionId);
	mkdirSync(sessionDir, { recursive: true });

	const settings = getCliPreset();
	const preset = CLI_PRESETS[settings.cliPreset];
	if (!preset) throw new Error(`Unknown CLI preset: ${settings.cliPreset}`);

	const promptFilePath = join(sessionDir, "install-prompt.txt");
	const promptText = opts.customPrompt ?? buildInstallPrompt(opts);
	writeFileSync(promptFilePath, promptText, "utf-8");

	const parts = [preset.command];
	if (settings.skipPermissions && preset.permissionFlag) {
		parts.push(preset.permissionFlag);
	}
	parts.push(`"$(cat -- "$2")"`);
	const cliCommand = parts.join(" ");

	const launchScript = join(sessionDir, "start-install.sh");
	const scriptContent = ["#!/bin/bash", 'cd -- "$1" || exit 1', "", cliCommand].join("\n");
	writeFileSync(launchScript, scriptContent, "utf-8");
	chmodSync(launchScript, 0o755);

	return { launchScript, promptFilePath, repoPath: opts.repoPath };
}
