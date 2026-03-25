import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { and, eq, inArray, not } from "drizzle-orm";
import { app } from "electron";
import type { SolveLaunchInfo } from "../../shared/solve-types";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { CLI_PRESETS, type LaunchOptions, isCliInstalled, resolveCliPath } from "./cli-presets";
import { buildSolvePrompt } from "./solve-prompt";
import { getSettings } from "./orchestrator";
import { resolveSessionWorktree } from "./solve-session-resolver";

// ─── State machine ────────────────────────────────────────────────────────────

const VALID_SOLVE_TRANSITIONS: Record<string, string[]> = {
	queued: ["in_progress", "failed", "dismissed"],
	in_progress: ["ready", "failed", "dismissed"],
	ready: ["submitted", "failed", "dismissed"],
	submitted: ["dismissed"],
	failed: ["dismissed"],
};

export function validateSolveTransition(currentStatus: string, newStatus: string): void {
	const allowed = VALID_SOLVE_TRANSITIONS[currentStatus];
	if (!allowed?.includes(newStatus)) {
		throw new Error(`Invalid solve session status transition: ${currentStatus} → ${newStatus}`);
	}
}

/**
 * Queue and launch a solve session.
 * Validates the worktree is clean, no other active sessions exist for this workspace,
 * then transitions to in_progress and builds the CLI launch script.
 */
export async function queueSolve(sessionId: string): Promise<SolveLaunchInfo> {
	const db = getDb();

	const { session, workspace, worktreePath } = resolveSessionWorktree(sessionId);

	// Validate no other active sessions for this workspace (excluding self)
	const activeForWorkspace = db
		.select()
		.from(schema.commentSolveSessions)
		.where(
			and(
				eq(schema.commentSolveSessions.workspaceId, session.workspaceId),
				inArray(schema.commentSolveSessions.status, ["queued", "in_progress"]),
				not(eq(schema.commentSolveSessions.id, sessionId))
			)
		)
		.get();

	if (activeForWorkspace) {
		throw new Error("Another solve session is already active for this workspace");
	}

	// Get AI settings
	const settings = getSettings();
	const preset = CLI_PRESETS[settings.cliPreset];
	if (!preset) throw new Error(`Unknown CLI preset: ${settings.cliPreset}`);
	if (!isCliInstalled(preset.command)) {
		throw new Error(`CLI tool '${preset.command}' is not installed`);
	}

	// Count open comments for this session
	const openComments = db
		.select()
		.from(schema.prComments)
		.where(
			and(eq(schema.prComments.solveSessionId, sessionId), eq(schema.prComments.status, "open"))
		)
		.all();

	const commentCount = openComments.length;

	// Transition status to in_progress
	const now = new Date();
	validateSolveTransition(session.status, "in_progress");
	db.update(schema.commentSolveSessions)
		.set({ status: "in_progress", updatedAt: now })
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.run();

	try {
		// Capture commit SHA
		const commitSha = execSync("git rev-parse HEAD", { cwd: worktreePath }).toString().trim();

		db.update(schema.commentSolveSessions)
			.set({ commitSha, updatedAt: new Date() })
			.where(eq(schema.commentSolveSessions.id, sessionId))
			.run();

		const dbPath = join(app.getPath("userData"), "branchflux.db");
		const mcpServerPath = resolve(__dirname, "mcp-server.js");

		// Build solve prompt
		const solvePromptText = buildSolvePrompt({
			prTitle: session.prTitle,
			sourceBranch: session.sourceBranch,
			targetBranch: session.targetBranch,
			commentCount,
			customPrompt: settings.solvePrompt ?? null,
		});

		// Write prompt to {userData}/solves/{sessionId}/solve-prompt.txt
		const solveDir = join(app.getPath("userData"), "solves", sessionId);
		mkdirSync(solveDir, { recursive: true });

		const promptFilePath = join(solveDir, "solve-prompt.txt");
		writeFileSync(promptFilePath, solvePromptText, "utf-8");

		// Build PR metadata JSON
		const prMetadata = JSON.stringify({
			title: session.prTitle,
			description: "",
			sourceBranch: session.sourceBranch,
			targetBranch: session.targetBranch,
			provider: session.prProvider,
			prUrl: "",
		});

		const launchOpts: LaunchOptions = {
			mcpServerPath,
			worktreePath,
			reviewDir: solveDir,
			promptFilePath,
			dbPath,
			reviewDraftId: sessionId,
			prMetadata,
			solveSessionId: sessionId,
		};

		// Setup MCP config (triggers solver env vars via solveSessionId)
		preset.setupMcp?.(launchOpts);

		// Build CLI command
		const args = preset.buildArgs(launchOpts);
		const resolvedCommand = resolveCliPath(preset.command);
		const parts = [resolvedCommand];
		if (settings.skipPermissions && preset.permissionFlag) {
			parts.push(preset.permissionFlag);
		}
		parts.push(...args);
		const cliCommand = parts.join(" ");

		// Build launch script
		const launchScript = join(solveDir, "start-solve.sh");
		const envLines = preset.setupMcp
			? []
			: [
					`export SOLVE_SESSION_ID='${sessionId}'`,
					`export PR_METADATA='${prMetadata.replace(/'/g, "'\\''")}'`,
					`export DB_PATH='${dbPath}'`,
					`export WORKTREE_PATH='${worktreePath}'`,
				];
		const scriptContent = ["#!/bin/bash", `cd '${worktreePath}'`, ...envLines, "", cliCommand].join(
			"\n"
		);
		writeFileSync(launchScript, scriptContent, "utf-8");
		chmodSync(launchScript, 0o755);

		return {
			sessionId,
			workspaceId: session.workspaceId,
			worktreePath,
			launchScript,
		};
	} catch (err) {
		console.error(`[comment-solver] queueSolve failed for ${sessionId}:`, err);
		db.update(schema.commentSolveSessions)
			.set({ status: "failed", updatedAt: new Date() })
			.where(eq(schema.commentSolveSessions.id, sessionId))
			.run();
		throw err;
	}
}

/**
 * Revert a fix group by running git revert on its commit hash.
 * Validates reverse-order constraint: no non-reverted groups with a higher order
 * in the same session may exist before this group can be reverted.
 */
export async function revertGroup(groupId: string, worktreePath: string): Promise<void> {
	const db = getDb();

	// Fetch the group
	const group = db
		.select()
		.from(schema.commentGroups)
		.where(eq(schema.commentGroups.id, groupId))
		.get();

	if (!group) throw new Error(`Comment group ${groupId} not found`);

	// Validate group has a commit hash
	if (!group.commitHash) {
		throw new Error(`Group ${groupId} has no commit hash — it cannot be reverted`);
	}

	// Validate not already reverted
	if (group.status === "reverted") {
		throw new Error(`Group ${groupId} is already reverted`);
	}

	// Validate reverse order: no non-reverted groups with higher order in same session
	const blockers = db
		.select()
		.from(schema.commentGroups)
		.where(
			and(
				eq(schema.commentGroups.solveSessionId, group.solveSessionId),
				not(eq(schema.commentGroups.status, "reverted")),
				not(eq(schema.commentGroups.id, groupId))
			)
		)
		.all()
		.filter((g) => g.order > group.order);

	if (blockers.length > 0) {
		throw new Error(
			`Cannot revert group ${groupId}: groups with higher order must be reverted first`
		);
	}

	// Run git revert
	execSync(`git revert ${group.commitHash} --no-edit`, { cwd: worktreePath });

	// Update group status to reverted
	db.update(schema.commentGroups)
		.set({ status: "reverted" })
		.where(eq(schema.commentGroups.id, groupId))
		.run();

	// Get comment IDs for this group
	const groupComments = db
		.select({ id: schema.prComments.id })
		.from(schema.prComments)
		.where(eq(schema.prComments.groupId, groupId))
		.all();

	const commentIds = groupComments.map((c) => c.id);

	if (commentIds.length > 0) {
		// Reset associated prComments to status "open"
		db.update(schema.prComments)
			.set({ status: "open" })
			.where(inArray(schema.prComments.id, commentIds))
			.run();

		// Delete draft commentReplies for this group's comments
		const draftReplies = db
			.select({ id: schema.commentReplies.id })
			.from(schema.commentReplies)
			.where(
				and(
					inArray(schema.commentReplies.prCommentId, commentIds),
					eq(schema.commentReplies.status, "draft")
				)
			)
			.all();

		const draftReplyIds = draftReplies.map((r) => r.id);
		if (draftReplyIds.length > 0) {
			db.delete(schema.commentReplies)
				.where(inArray(schema.commentReplies.id, draftReplyIds))
				.run();
		}
	}
}
