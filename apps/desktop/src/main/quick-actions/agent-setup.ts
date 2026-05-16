import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { app } from "electron";
import { buildDefaultPrompt } from "../../shared/quick-action-prompt";
import { CLI_PRESETS } from "../ai-review/cli-presets";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { getTaskRegistry } from "../services/task-registry-handle";

export interface AgentSetupLaunchInfo {
	sessionId: string;
	launchScript: string;
}

function getSettings(): schema.AiReviewSettings {
	const db = getDb();
	const existing = db
		.select()
		.from(schema.aiReviewSettings)
		.where(eq(schema.aiReviewSettings.id, "default"))
		.get();

	if (existing) return existing;

	const now = new Date();
	db.insert(schema.aiReviewSettings)
		.values({
			id: "default",
			cliPreset: "claude",
			autoReviewEnabled: 0,
			skipPermissions: 1,
			maxConcurrentReviews: 3,
			updatedAt: now,
		})
		.run();

	return db
		.select()
		.from(schema.aiReviewSettings)
		.where(eq(schema.aiReviewSettings.id, "default"))
		.get()!;
}

export async function launchSetupAgent(
	projectId: string,
	repoPath: string,
	customPrompt?: string
): Promise<AgentSetupLaunchInfo> {
	const sessionId = randomUUID();
	const dbPath = join(app.getPath("userData"), "superiorswarm.db");

	const sessionDir = join(app.getPath("userData"), "quick-action-setup", sessionId);
	mkdirSync(sessionDir, { recursive: true });

	const settings = getSettings();
	const preset = CLI_PRESETS[settings.cliPreset];
	if (!preset) throw new Error(`Unknown CLI preset: ${settings.cliPreset}`);

	// Write the prompt file — use custom prompt if provided, otherwise default
	const promptFilePath = join(sessionDir, "setup-prompt.txt");
	const promptText = customPrompt || buildDefaultPrompt(repoPath);
	writeFileSync(promptFilePath, promptText, "utf-8");

	// Register a task token so the global MCP server can look up context
	const taskToken = randomUUID();
	getTaskRegistry().register(taskToken, {
		mode: "quick-action-setup",
		projectId,
		workspaceId: "",
		modeContext: {
			dbPath,
			worktreePath: repoPath,
		},
	});

	// Build the CLI invocation — we craft our own prompt arg instead of using
	// preset.buildArgs() which generates review-specific text ("Review this PR...").
	// Use the bare command name; the login-shell PTY resolves it from the user's PATH.
	const parts = [preset.command];
	if (settings.skipPermissions && preset.permissionFlag) {
		parts.push(preset.permissionFlag);
	}
	// Each CLI takes the prompt differently, but they all accept it as the last arg
	// in a quoted string. We point it at the setup-prompt.txt file.
	const promptArg = `"Help set up quick action buttons for this project. Read ${promptFilePath} for detailed instructions and use the SuperiorSwarm MCP tools."`;
	parts.push(promptArg);
	const cliCommand = parts.join(" ");

	// Write the launch script
	const launchScript = join(sessionDir, "start-setup.sh");
	const scriptContent = [
		"#!/bin/bash",
		`cd '${repoPath}'`,
		`export SUPERIORSWARM_TASK_TOKEN='${taskToken}'`,
		"",
		cliCommand,
	].join("\n");
	writeFileSync(launchScript, scriptContent, "utf-8");
	chmodSync(launchScript, 0o755);

	return { sessionId, launchScript };
}
