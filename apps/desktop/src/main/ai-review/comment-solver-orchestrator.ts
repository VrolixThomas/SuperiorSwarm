import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, count, eq, gt, inArray, not } from "drizzle-orm";
import { app } from "electron";
import type { SolveLaunchInfo, SolveSessionStatus } from "../../shared/solve-types";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { CLI_PRESETS, type LaunchOptions } from "./cli-presets";
import { getMcpServerPath } from "./mcp-path";
import { getSettings } from "./orchestrator";
import { buildSolvePrompt } from "./solve-prompt";
import { resolveSessionWorktree } from "./solve-session-resolver";

// ─── State machine ────────────────────────────────────────────────────────────

const VALID_SOLVE_TRANSITIONS: Record<SolveSessionStatus, SolveSessionStatus[]> = {
	queued: ["in_progress", "failed", "dismissed", "cancelled"],
	in_progress: ["ready", "failed", "dismissed", "cancelled"],
	ready: ["submitted", "failed", "dismissed"],
	submitted: ["dismissed"],
	failed: ["dismissed"],
	cancelled: ["dismissed"],
	dismissed: [],
};

export function validateSolveTransition(
	currentStatus: SolveSessionStatus,
	newStatus: SolveSessionStatus
): void {
	const allowed = VALID_SOLVE_TRANSITIONS[currentStatus];
	if (!allowed.includes(newStatus)) {
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

	const countResult = db
		.select({ value: count() })
		.from(schema.prComments)
		.where(
			and(eq(schema.prComments.solveSessionId, sessionId), eq(schema.prComments.status, "open"))
		)
		.get();
	const commentCount = countResult?.value ?? 0;

	const now = new Date();
	validateSolveTransition(session.status, "in_progress");
	db.update(schema.commentSolveSessions)
		.set({ status: "in_progress", updatedAt: now })
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.run();

	try {
		const commitSha = execSync("git rev-parse HEAD", { cwd: worktreePath }).toString().trim();

		db.update(schema.commentSolveSessions)
			.set({ commitSha, updatedAt: new Date() })
			.where(eq(schema.commentSolveSessions.id, sessionId))
			.run();

		const dbPath = join(app.getPath("userData"), "superiorswarm.db");
		const mcpServerPath = getMcpServerPath();

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

		// Build CLI command. See orchestrator.ts:startReview for the rationale
		// behind using the bare command name instead of an absolute path.
		const args = preset.buildArgs(launchOpts);
		const parts = [preset.command];
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
		const pidFilePath = join(solveDir, "solver.pid");
		const scriptContent = [
			"#!/bin/bash",
			`echo $$ > '${pidFilePath}'`,
			`cd '${worktreePath}'`,
			...envLines,
			"",
			cliCommand,
		].join("\n");
		writeFileSync(launchScript, scriptContent, "utf-8");
		chmodSync(launchScript, 0o755);

		// Read PID file and store on session after the script has had time to write it
		setTimeout(() => {
			try {
				const pidContent = readFileSync(pidFilePath, "utf-8").trim();
				const pid = Number.parseInt(pidContent, 10);
				if (!Number.isNaN(pid)) {
					getDb()
						.update(schema.commentSolveSessions)
						.set({ pid, updatedAt: new Date() })
						.where(eq(schema.commentSolveSessions.id, sessionId))
						.run();
					console.log(`[comment-solver] Stored PID ${pid} for session ${sessionId}`);
				}
			} catch {
				// PID file not yet written or session already gone — ignore
			}
		}, 2000);

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
 * On app startup, sweep for sessions stuck in queued/in_progress.
 * - If pid is set: attempt process.kill(pid, 0) to check if process is alive. If dead, mark failed.
 * - If pid is null: fall back to lastActivityAt staleness (10 min threshold).
 */
export function recoverStuckSessions(): void {
	const db = getDb();
	const now = new Date();
	const TEN_MIN_MS = 10 * 60 * 1000;
	const cutoff = new Date(now.getTime() - TEN_MIN_MS);

	const stuck = db
		.select()
		.from(schema.commentSolveSessions)
		.where(inArray(schema.commentSolveSessions.status, ["queued", "in_progress"]))
		.all();

	for (const session of stuck) {
		let shouldFail = false;

		if (session.pid !== null) {
			try {
				process.kill(session.pid, 0); // signal 0 = check existence only
				// Process exists — don't fail it
			} catch (killErr) {
				// Only ESRCH means "no such process" — EPERM means process exists but we can't signal it
				if ((killErr as NodeJS.ErrnoException).code === "ESRCH") {
					shouldFail = true;
				}
				// EPERM or other errors: assume the process is still alive
			}
		} else {
			// No PID — fall back to activity timestamp, or createdAt if no activity yet
			const anchor = session.lastActivityAt ?? session.createdAt;
			if (anchor !== null && anchor < cutoff) {
				shouldFail = true;
			}
		}

		if (shouldFail) {
			console.log(`[comment-solver] Recovering stuck session ${session.id} → failed`);
			db.update(schema.commentSolveSessions)
				.set({ status: "failed", updatedAt: now })
				.where(eq(schema.commentSolveSessions.id, session.id))
				.run();
		}
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
				not(eq(schema.commentGroups.id, groupId)),
				gt(schema.commentGroups.order, group.order)
			)
		)
		.all();

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

/**
 * Check whether a solve session's agent process is dead.
 * Used by getSolveSession to lazily mark sessions failed on poll.
 */
export function isSessionDead(
	session: { pid: number | null; lastActivityAt: Date | null; createdAt: Date },
	now: Date
): boolean {
	const TEN_MIN_MS = 10 * 60 * 1000;
	const cutoff = new Date(now.getTime() - TEN_MIN_MS);

	if (session.pid !== null) {
		try {
			process.kill(session.pid, 0);
			return false; // Process exists
		} catch (killErr) {
			return (killErr as NodeJS.ErrnoException).code === "ESRCH";
		}
	}

	// No PID — fall back to activity timestamp
	const anchor = session.lastActivityAt ?? session.createdAt;
	return anchor !== null && anchor < cutoff;
}

/**
 * Cancel an in-progress or queued solve session.
 * Kills the agent process (if PID is known), deletes pending groups and resets
 * their comments back to "open", then marks the session "cancelled".
 * Fixed groups are preserved so partial work survives.
 */
export function cancelSolve(sessionId: string): void {
	const db = getDb();

	const session = db
		.select()
		.from(schema.commentSolveSessions)
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.get();

	if (!session) throw new Error(`Session ${sessionId} not found`);

	validateSolveTransition(session.status, "cancelled");

	// Kill the agent process if PID is available
	if (session.pid) {
		try {
			process.kill(session.pid, "SIGTERM");
		} catch (err: unknown) {
			// ESRCH = process already dead, that's fine
			if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
				throw err;
			}
		}
	}

	db.transaction((tx) => {
		// Find pending groups to delete
		const pendingGroups = tx
			.select()
			.from(schema.commentGroups)
			.where(
				and(
					eq(schema.commentGroups.solveSessionId, sessionId),
					eq(schema.commentGroups.status, "pending"),
				)
			)
			.all();

		for (const group of pendingGroups) {
			// Reset comments that belonged to this pending group
			tx.update(schema.prComments)
				.set({ groupId: null, status: "open" })
				.where(eq(schema.prComments.groupId, group.id))
				.run();

			// Delete the pending group
			tx.delete(schema.commentGroups)
				.where(eq(schema.commentGroups.id, group.id))
				.run();
		}

		// Mark session cancelled
		tx.update(schema.commentSolveSessions)
			.set({ status: "cancelled", updatedAt: new Date() })
			.where(eq(schema.commentSolveSessions.id, sessionId))
			.run();
	});
}
