import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { app } from "electron";
import { getDb } from "../db";
import * as schema from "../db/schema";
import {
	CLI_PRESETS,
	type LaunchOptions,
	isCliInstalled,
	resolveCliPath,
} from "../ai-review/cli-presets";
import { eq } from "drizzle-orm";

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

function buildSetupPrompt(projectId: string, repoPath: string): string {
	return `You are helping set up quick action buttons for a Git repository in SuperiorSwarm.

Repository: ${repoPath}
Project ID: ${projectId}

Quick action buttons appear in the top bar and let developers run common commands (build, test, lint, etc.) with a single click or keyboard shortcut.

Your job:
1. Explore the repository to understand what kind of project this is (look at package.json, Makefile, scripts/, etc.)
2. Call \`list_quick_actions\` to see what quick actions are already configured
3. Suggest and add relevant quick actions using \`add_quick_action\` for common workflows such as:
   - Build / compile
   - Test / run tests
   - Lint / format
   - Start dev server
   - Any other project-specific commands you find
4. Use \`scope: "repo"\` for project-specific commands, \`scope: "global"\` only for universally applicable ones
5. Keep labels short (1-2 words), e.g. "Build", "Test", "Lint", "Dev"

Use the MCP tools to add the quick actions. Do not ask for confirmation — just explore and add the most useful ones.`;
}

export async function launchSetupAgent(
	projectId: string,
	repoPath: string
): Promise<AgentSetupLaunchInfo> {
	const sessionId = randomUUID();
	const dbPath = join(app.getPath("userData"), "superiorswarm.db");

	const sessionDir = join(app.getPath("userData"), "quick-action-setup", sessionId);
	mkdirSync(sessionDir, { recursive: true });

	const settings = getSettings();
	const preset = CLI_PRESETS[settings.cliPreset];
	if (!preset) throw new Error(`Unknown CLI preset: ${settings.cliPreset}`);
	if (!isCliInstalled(preset.command)) {
		throw new Error(`CLI tool '${preset.command}' is not installed`);
	}

	// Use the standalone MCP server (same path resolution as cli-presets.ts)
	const standaloneServerPath = resolve(dirname(__dirname), "..", "mcp-standalone", "server.mjs");

	// Write the prompt file
	const promptFilePath = join(sessionDir, "setup-prompt.txt");
	writeFileSync(promptFilePath, buildSetupPrompt(projectId, repoPath), "utf-8");

	// Build LaunchOptions — reuse the existing interface, mapping quick-action fields
	// to the review-specific fields the preset expects
	const launchOpts: LaunchOptions = {
		mcpServerPath: standaloneServerPath,
		worktreePath: repoPath,
		reviewDir: sessionDir,
		promptFilePath,
		dbPath,
		reviewDraftId: "", // not a review session — MCP server uses QUICK_ACTION_SETUP mode
		prMetadata: JSON.stringify({}),
		// Pass session context via solveSessionId field (repurposed for quick-action setup)
		solveSessionId: sessionId,
	};

	// Write MCP config with quick-action-specific env vars.
	// We write .mcp.json directly since setupMcp would inject solve-mode env vars,
	// but we need QUICK_ACTION_SETUP + PROJECT_ID instead.
	const mcpConfigPath = join(repoPath, ".mcp.json");
	const mcpConfig = {
		mcpServers: {
			superiorswarm: {
				command: "node",
				args: [standaloneServerPath],
				env: {
					QUICK_ACTION_SETUP: "1",
					PROJECT_ID: projectId,
					DB_PATH: dbPath,
					WORKTREE_PATH: repoPath,
				},
			},
		},
	};
	writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf-8");

	// Build the CLI invocation using the preset's args builder
	const args = preset.buildArgs(launchOpts);
	const resolvedCommand = resolveCliPath(preset.command);
	const parts = [resolvedCommand];
	if (settings.skipPermissions && preset.permissionFlag) {
		parts.push(preset.permissionFlag);
	}
	parts.push(...args);
	const cliCommand = parts.join(" ");

	// Write the launch script
	const launchScript = join(sessionDir, "start-setup.sh");
	const scriptContent = [
		"#!/bin/bash",
		`cd '${repoPath}'`,
		"",
		cliCommand,
	].join("\n");
	writeFileSync(launchScript, scriptContent, "utf-8");
	chmodSync(launchScript, 0o755);

	return { sessionId, launchScript };
}
