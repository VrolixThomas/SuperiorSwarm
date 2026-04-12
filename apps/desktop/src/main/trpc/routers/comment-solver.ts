import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, not } from "drizzle-orm";
import { app } from "electron";
import { z } from "zod";
import { CLI_PRESETS, type LaunchOptions } from "../../ai-review/cli-presets";
import { pollWorkspace } from "../../ai-review/comment-poller";
import {
	cancelSolve,
	isSessionDead,
	revertGroup as revertGroupOrchestrator,
} from "../../ai-review/comment-solver-orchestrator";
import { createAndQueueSolve } from "../../ai-review/create-and-queue-solve";
import { getMcpServerPath } from "../../ai-review/mcp-path";
import { getSettings } from "../../ai-review/orchestrator";
import { buildSolveFollowUpPrompt } from "../../ai-review/solve-prompt";
import { publishGroup, publishSolve } from "../../ai-review/solve-publisher";
import { resolveSessionWorktree } from "../../ai-review/solve-session-resolver";
import { getDb } from "../../db";
import * as schema from "../../db/schema";
import type {
	ChangedFile,
	SolveCommentStatus,
	SolveGroupStatus,
	SolveLaunchInfo,
	SolveReplyStatus,
	SolveSessionInfo,
	SolveSessionStatus,
} from "../../shared/solve-types";
import { publicProcedure, router } from "../index";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Assemble a SolveSessionInfo from DB records */
function assembleSolveSession(sessionId: string): SolveSessionInfo | null {
	const db = getDb();

	const session = db
		.select()
		.from(schema.commentSolveSessions)
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.get();

	if (!session) return null;

	const groups = db
		.select()
		.from(schema.commentGroups)
		.where(eq(schema.commentGroups.solveSessionId, sessionId))
		.orderBy(schema.commentGroups.order)
		.all();

	const allComments = db
		.select()
		.from(schema.prComments)
		.where(eq(schema.prComments.solveSessionId, sessionId))
		.all();

	const commentIds = allComments.map((c) => c.id);
	const allReplies =
		commentIds.length > 0
			? db
					.select()
					.from(schema.commentReplies)
					.where(inArray(schema.commentReplies.prCommentId, commentIds))
					.all()
			: [];

	const repliesByCommentId = new Map<string, (typeof allReplies)[0]>();
	for (const reply of allReplies) {
		repliesByCommentId.set(reply.prCommentId, reply);
	}

	const commentsByGroupId = new Map<string, typeof allComments>();
	for (const comment of allComments) {
		const key = comment.groupId ?? "__ungrouped__";
		const arr = commentsByGroupId.get(key) ?? [];
		arr.push(comment);
		commentsByGroupId.set(key, arr);
	}

	const groupInfos: SolveSessionInfo["groups"] = groups.map((group) => {
		const comments = commentsByGroupId.get(group.id) ?? [];

		return {
			id: group.id,
			label: group.label,
			status: group.status as SolveGroupStatus,
			commitHash: group.commitHash ?? null,
			order: group.order,
			changedFiles: group.changedFiles ? (JSON.parse(group.changedFiles) as ChangedFile[]) : [],
			comments: comments.map((comment) => {
				const reply = repliesByCommentId.get(comment.id);
				return {
					id: comment.id,
					platformCommentId: comment.platformCommentId,
					author: comment.author,
					body: comment.body,
					filePath: comment.filePath,
					lineNumber: comment.lineNumber ?? null,
					side: comment.side ?? null,
					threadId: comment.threadId ?? null,
					status: comment.status as SolveCommentStatus,
					commitSha: comment.commitSha ?? null,
					groupId: comment.groupId ?? null,
					followUpText: comment.followUpText ?? null,
					reply: reply
						? { id: reply.id, body: reply.body, status: reply.status as SolveReplyStatus }
						: null,
				};
			}),
		};
	});

	return {
		id: session.id,
		prProvider: session.prProvider,
		prIdentifier: session.prIdentifier,
		prTitle: session.prTitle,
		sourceBranch: session.sourceBranch,
		targetBranch: session.targetBranch,
		status: session.status as SolveSessionStatus,
		commitSha: session.commitSha ?? null,
		workspaceId: session.workspaceId,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		lastActivityAt: session.lastActivityAt ?? null,
		groups: groupInfos,
	};
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const commentSolverRouter = router({
	/**
	 * List all active solve sessions, optionally filtered by workspace.
	 * Excludes dismissed sessions.
	 */
	getSolveSessions: publicProcedure
		.input(z.object({ workspaceId: z.string().optional() }))
		.query(({ input }) => {
			const db = getDb();
			const conditions = [not(eq(schema.commentSolveSessions.status, "dismissed"))];
			if (input.workspaceId) {
				conditions.push(eq(schema.commentSolveSessions.workspaceId, input.workspaceId));
			}
			return db
				.select()
				.from(schema.commentSolveSessions)
				.where(and(...conditions))
				.all();
		}),

	getPendingCommentEvents: publicProcedure.query(() => {
		const db = getDb();
		return db
			.select()
			.from(schema.commentEvents)
			.where(eq(schema.commentEvents.status, "pending"))
			.all();
	}),

	/**
	 * Get a single solve session assembled with groups, comments, and replies.
	 */
	getSolveSession: publicProcedure.input(z.object({ sessionId: z.string() })).query(({ input }) => {
		const info = assembleSolveSession(input.sessionId);
		if (!info) throw new Error(`Solve session ${input.sessionId} not found`);

		// Liveness check for active sessions
		if (info.status === "queued" || info.status === "in_progress") {
			const db = getDb();
			const session = db
				.select()
				.from(schema.commentSolveSessions)
				.where(eq(schema.commentSolveSessions.id, input.sessionId))
				.get();

			if (session) {
				const now = new Date();
				if (isSessionDead(session, now)) {
					db.update(schema.commentSolveSessions)
						.set({ status: "failed", updatedAt: now })
						.where(eq(schema.commentSolveSessions.id, input.sessionId))
						.run();
					return assembleSolveSession(input.sessionId)!;
				}
			}
		}

		return info;
	}),

	/**
	 * Get platform comments for a PR that are not yet in any active solve session.
	 */
	getUnresolvedComments: publicProcedure
		.input(z.object({ prIdentifier: z.string() }))
		.query(({ input }) => {
			const db = getDb();
			// Find all active sessions for this PR (not dismissed/reverted)
			const activeSessions = db
				.select({ id: schema.commentSolveSessions.id })
				.from(schema.commentSolveSessions)
				.where(
					and(
						eq(schema.commentSolveSessions.prIdentifier, input.prIdentifier),
						not(eq(schema.commentSolveSessions.status, "dismissed"))
					)
				)
				.all();

			const activeSessionIds = activeSessions.map((s) => s.id);

			if (activeSessionIds.length === 0) {
				return [];
			}

			// Return comments from active sessions that are still "open"
			return db
				.select()
				.from(schema.prComments)
				.where(
					and(
						inArray(schema.prComments.solveSessionId, activeSessionIds),
						eq(schema.prComments.status, "open")
					)
				)
				.all();
		}),

	/**
	 * Fetch PR comments for a workspace's linked PR from the local cache.
	 * Returns raw platform comments without any session context.
	 */
	getWorkspaceComments: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.query(({ input }) => {
			const db = getDb();

			const workspace = db
				.select()
				.from(schema.workspaces)
				.where(eq(schema.workspaces.id, input.workspaceId))
				.get();

			if (!workspace || !workspace.prProvider || !workspace.prIdentifier) {
				return [];
			}

			return db
				.select()
				.from(schema.prCommentCache)
				.where(eq(schema.prCommentCache.workspaceId, input.workspaceId))
				.all()
				.map((c) => ({
					platformId: c.platformCommentId,
					author: c.author,
					body: c.body,
					filePath: c.filePath,
					lineNumber: c.lineNumber,
					createdAt: c.createdAt,
				}));
		}),

	/**
	 * Trigger an immediate poll for a single workspace, updating the comment cache.
	 * Called by the renderer when the Comments tab is opened.
	 */
	refreshWorkspaceComments: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.mutation(async ({ input }) => {
			const db = getDb();

			const workspace = db
				.select()
				.from(schema.workspaces)
				.where(eq(schema.workspaces.id, input.workspaceId))
				.get();

			if (!workspace) return { success: false };
			if (!workspace.prProvider || !workspace.prIdentifier) return { success: false };

			await pollWorkspace(workspace);
			return { success: true };
		}),

	/**
	 * Main entry point: fetch PR comments from platform, create a solve session,
	 * and queue the AI solve job.
	 */
	triggerSolve: publicProcedure
		.input(z.object({ workspaceId: z.string(), excludeCommentIds: z.array(z.string()).optional() }))
		.mutation(async ({ input }): Promise<SolveLaunchInfo> => {
			const db = getDb();

			// Dismiss any pending comment event for this workspace
			const workspace = db
				.select()
				.from(schema.workspaces)
				.where(eq(schema.workspaces.id, input.workspaceId))
				.get();

			if (workspace?.prIdentifier) {
				db.update(schema.commentEvents)
					.set({ status: "dismissed" })
					.where(
						and(
							eq(schema.commentEvents.prIdentifier, workspace.prIdentifier),
							eq(schema.commentEvents.status, "pending")
						)
					)
					.run();
			}

			return createAndQueueSolve({
				workspaceId: input.workspaceId,
				excludeCommentIds: input.excludeCommentIds,
			});
		}),

	/**
	 * Approve a fixed group (transitions "fixed" → "approved").
	 */
	approveGroup: publicProcedure.input(z.object({ groupId: z.string() })).mutation(({ input }) => {
		const db = getDb();
		const group = db
			.select()
			.from(schema.commentGroups)
			.where(eq(schema.commentGroups.id, input.groupId))
			.get();

		if (!group) throw new Error(`Comment group ${input.groupId} not found`);
		if (group.status !== "fixed") {
			throw new Error(`Cannot approve group with status "${group.status}" — expected "fixed"`);
		}

		db.update(schema.commentGroups)
			.set({ status: "approved" })
			.where(eq(schema.commentGroups.id, input.groupId))
			.run();

		return { success: true };
	}),

	/**
	 * Approve a draft reply on an unclear comment.
	 * Sets reply status from "draft" → "approved".
	 */
	approveReply: publicProcedure.input(z.object({ replyId: z.string() })).mutation(({ input }) => {
		const db = getDb();

		const reply = db
			.select()
			.from(schema.commentReplies)
			.where(eq(schema.commentReplies.id, input.replyId))
			.get();

		if (!reply) throw new Error(`Reply ${input.replyId} not found`);

		db.update(schema.commentReplies)
			.set({ status: "approved" })
			.where(eq(schema.commentReplies.id, input.replyId))
			.run();

		return { success: true };
	}),

	/**
	 * Revoke a previously approved group.
	 * Resets group status "approved" → "fixed" and returns all approved replies
	 * in the group back to "draft" so the sign-off strip re-appears.
	 */
	revokeGroup: publicProcedure.input(z.object({ groupId: z.string() })).mutation(({ input }) => {
		const db = getDb();

		const group = db
			.select()
			.from(schema.commentGroups)
			.where(eq(schema.commentGroups.id, input.groupId))
			.get();

		if (!group) throw new Error(`Comment group ${input.groupId} not found`);
		if (group.status !== "approved") {
			throw new Error(`Cannot revoke group with status "${group.status}" — expected "approved"`);
		}

		db.update(schema.commentGroups)
			.set({ status: "fixed" })
			.where(eq(schema.commentGroups.id, input.groupId))
			.run();

		const comments = db
			.select({ id: schema.prComments.id })
			.from(schema.prComments)
			.where(eq(schema.prComments.groupId, input.groupId))
			.all();

		const commentIds = comments.map((c) => c.id);
		if (commentIds.length > 0) {
			db.update(schema.commentReplies)
				.set({ status: "draft" })
				.where(
					and(
						inArray(schema.commentReplies.prCommentId, commentIds),
						eq(schema.commentReplies.status, "approved")
					)
				)
				.run();
		}

		return { success: true };
	}),

	/**
	 * Revert a fix group by running git revert on its commit.
	 */
	revertGroup: publicProcedure
		.input(z.object({ groupId: z.string() }))
		.mutation(async ({ input }) => {
			const db = getDb();

			const group = db
				.select()
				.from(schema.commentGroups)
				.where(eq(schema.commentGroups.id, input.groupId))
				.get();
			if (!group) throw new Error(`Comment group ${input.groupId} not found`);
			const { worktreePath } = resolveSessionWorktree(group.solveSessionId);
			await revertGroupOrchestrator(input.groupId, worktreePath);
			return { success: true };
		}),

	/**
	 * Update a comment reply's body.
	 * Always resets status to "draft" — the user must re-approve via the
	 * sign-off strip after editing. Use approveReply for status transitions.
	 */
	updateReply: publicProcedure
		.input(
			z.object({
				replyId: z.string(),
				body: z.string().optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const updates: Record<string, unknown> = {};

			if (input.body !== undefined) {
				updates.body = input.body;
				updates.status = "draft"; // Always reset when body changes
			}

			if (Object.keys(updates).length === 0) {
				return { success: true };
			}

			db.update(schema.commentReplies)
				.set(updates)
				.where(eq(schema.commentReplies.id, input.replyId))
				.run();

			return { success: true };
		}),

	/**
	 * Delete a comment reply.
	 */
	deleteReply: publicProcedure.input(z.object({ replyId: z.string() })).mutation(({ input }) => {
		const db = getDb();
		db.delete(schema.commentReplies).where(eq(schema.commentReplies.id, input.replyId)).run();
		return { success: true };
	}),

	/**
	 * Add a new reply to a comment.
	 * By default creates as "approved" (user explicitly wrote it = implicit sign-off).
	 * Pass draft: true to create as "draft" — used when undoing a discard.
	 */
	addReply: publicProcedure
		.input(z.object({ commentId: z.string(), body: z.string(), draft: z.boolean().default(false) }))
		.mutation(({ input }) => {
			const db = getDb();
			const id = randomUUID();
			db.insert(schema.commentReplies)
				.values({
					id,
					prCommentId: input.commentId,
					body: input.body,
					status: input.draft ? "draft" : "approved",
				})
				.run();
			return { id, success: true };
		}),

	/**
	 * Push commits and post approved replies to the platform.
	 * Validates all groups are approved and all replies are resolved first.
	 */
	/**
	 * Push a single approved group's commits and post its replies.
	 */
	pushGroup: publicProcedure
		.input(z.object({ groupId: z.string() }))
		.mutation(async ({ input }) => {
			const db = getDb();

			const group = db
				.select()
				.from(schema.commentGroups)
				.where(eq(schema.commentGroups.id, input.groupId))
				.get();
			if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
			if (group.status !== "approved" && group.status !== "fixed") {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Group must be fixed or approved before pushing",
				});
			}

			// Validate no draft replies in this group
			const groupCommentIds = db
				.select({ id: schema.prComments.id })
				.from(schema.prComments)
				.where(eq(schema.prComments.groupId, input.groupId))
				.all()
				.map((c) => c.id);

			if (groupCommentIds.length > 0) {
				const draftReplies = db
					.select()
					.from(schema.commentReplies)
					.where(
						and(
							inArray(schema.commentReplies.prCommentId, groupCommentIds),
							eq(schema.commentReplies.status, "draft")
						)
					)
					.all();
				if (draftReplies.length > 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: `Sign off ${draftReplies.length} draft reply/replies before pushing`,
					});
				}
			}

			// Auto-approve if still in fixed state (user chose to push directly)
			if (group.status === "fixed") {
				db.update(schema.commentGroups)
					.set({ status: "approved" })
					.where(eq(schema.commentGroups.id, input.groupId))
					.run();
			}

			return publishGroup(input.groupId);
		}),

	pushAndPost: publicProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ input }) => {
			const db = getDb();

			// Require at least one approved group
			const approvedGroups = db
				.select()
				.from(schema.commentGroups)
				.where(
					and(
						eq(schema.commentGroups.solveSessionId, input.sessionId),
						eq(schema.commentGroups.status, "approved")
					)
				)
				.all();
			if (approvedGroups.length === 0) {
				throw new Error("No approved groups to push");
			}

			// Validate no draft replies in approved groups
			const approvedCommentIds = db
				.select({ id: schema.prComments.id })
				.from(schema.prComments)
				.where(inArray(schema.prComments.groupId, approvedGroups.map((g) => g.id)))
				.all()
				.map((c) => c.id);

			if (approvedCommentIds.length > 0) {
				const draftReplies = db
					.select()
					.from(schema.commentReplies)
					.where(
						and(
							inArray(schema.commentReplies.prCommentId, approvedCommentIds),
							eq(schema.commentReplies.status, "draft")
						)
					)
					.all();
				if (draftReplies.length > 0) {
					throw new Error(
						`Cannot publish: ${draftReplies.length} draft reply/replies still pending approval`
					);
				}
			}

			return publishSolve(input.sessionId);
		}),

	/**
	 * Dismiss a solve session, reverting all fix commits and marking it dismissed.
	 */
	dismissSolve: publicProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ input }) => {
			const db = getDb();

			// Fetch session
			const session = db
				.select()
				.from(schema.commentSolveSessions)
				.where(eq(schema.commentSolveSessions.id, input.sessionId))
				.get();

			if (!session) throw new Error(`Solve session ${input.sessionId} not found`);

			let worktreePath: string | null = null;
			try {
				worktreePath = resolveSessionWorktree(input.sessionId).worktreePath;
			} catch {
				// Worktree may have been deleted — still allow dismiss
			}

			// Fetch groups that have commits to revert, ordered in reverse
			if (worktreePath) {
				const groups = db
					.select()
					.from(schema.commentGroups)
					.where(eq(schema.commentGroups.solveSessionId, input.sessionId))
					.orderBy(schema.commentGroups.order)
					.all();

				// Revert in reverse order (highest order first)
				const groupsToRevert = groups
					.filter((g) => (g.status === "fixed" || g.status === "approved") && g.commitHash)
					.reverse();

				for (const group of groupsToRevert) {
					try {
						await revertGroupOrchestrator(group.id, worktreePath);
					} catch (err) {
						console.error(`[comment-solver] Failed to revert group ${group.id}:`, err);
						// Continue reverting remaining groups
					}
				}
			}

			// Update session status to dismissed
			db.update(schema.commentSolveSessions)
				.set({ status: "dismissed", updatedAt: new Date() })
				.where(eq(schema.commentSolveSessions.id, input.sessionId))
				.run();

			return { success: true };
		}),

	/**
	 * Cancel an in-progress or queued session.
	 * Kills the agent process, deletes pending groups, and marks the session cancelled.
	 * Fixed groups are preserved so partial work survives.
	 */
	cancelSolve: publicProcedure.input(z.object({ sessionId: z.string() })).mutation(({ input }) => {
		cancelSolve(input.sessionId);
		return { success: true as const };
	}),

	/**
	 * Request follow-up changes on a specific comment after the AI solver has completed.
	 * Stores the follow-up text, reverts group approval if needed, and launches a new agent.
	 */
	requestFollowUp: publicProcedure
		.input(
			z.object({
				commentId: z.string(),
				followUpText: z.string().min(1),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();

			// Store follow-up text and set status to changes_requested
			db.update(schema.prComments)
				.set({
					followUpText: input.followUpText,
					status: "changes_requested",
				})
				.where(eq(schema.prComments.id, input.commentId))
				.run();

			const comment = db
				.select()
				.from(schema.prComments)
				.where(eq(schema.prComments.id, input.commentId))
				.get();

			if (!comment) throw new TRPCError({ code: "NOT_FOUND", message: "Comment not found" });

			// If the comment's group was approved, revoke it back to fixed
			if (comment.groupId) {
				const group = db
					.select()
					.from(schema.commentGroups)
					.where(eq(schema.commentGroups.id, comment.groupId))
					.get();

				if (group?.status === "approved") {
					db.update(schema.commentGroups)
						.set({ status: "fixed" })
						.where(eq(schema.commentGroups.id, group.id))
						.run();
				}
			}

			// Get session and group for prompt building
			const session = comment.solveSessionId
				? db
						.select()
						.from(schema.commentSolveSessions)
						.where(eq(schema.commentSolveSessions.id, comment.solveSessionId))
						.get()
				: null;

			const group = comment.groupId
				? db
						.select()
						.from(schema.commentGroups)
						.where(eq(schema.commentGroups.id, comment.groupId))
						.get()
				: null;

			if (!session || !group) {
				throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Session or group not found" });
			}

			const prompt = buildSolveFollowUpPrompt({
				prTitle: session.prTitle,
				sourceBranch: session.sourceBranch,
				targetBranch: session.targetBranch,
				sessionId: session.id,
				groupLabel: group.label,
				commitHash: group.commitHash ?? "unknown",
				commentAuthor: comment.author,
				commentFilePath: comment.filePath,
				commentLineNumber: comment.lineNumber,
				commentBody: comment.body,
				commentStatus: comment.status,
				followUpText: input.followUpText,
			});

			// Write prompt to disk
			const solveDir = join(app.getPath("userData"), "solves", session.id);
			mkdirSync(solveDir, { recursive: true });
			const promptPath = join(solveDir, `follow-up-${Date.now()}.txt`);
			writeFileSync(promptPath, prompt, "utf-8");

			// Resolve worktree for this session
			let worktreePath: string;
			try {
				({ worktreePath } = resolveSessionWorktree(session.id));
			} catch (err) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: `Worktree not found: ${String(err)}`,
				});
			}

			// Build launch script using active CLI preset
			const settings = getSettings();
			const preset = CLI_PRESETS[settings.cliPreset ?? "claude"];
			const launchScript = join(solveDir, `follow-up-launch-${Date.now()}.sh`);
			const dbPath = join(app.getPath("userData"), "superiorswarm.db");
			const prMetadata = JSON.stringify({
				title: session.prTitle,
				sourceBranch: session.sourceBranch,
				targetBranch: session.targetBranch,
				provider: session.prProvider,
			});
			const launchOpts: LaunchOptions = {
				mcpServerPath: getMcpServerPath(),
				worktreePath,
				reviewDir: solveDir,
				promptFilePath: promptPath,
				dbPath,
				reviewDraftId: session.id,
				prMetadata,
				solveSessionId: session.id,
			};

			preset.setupMcp?.(launchOpts);

			const launchArgs = preset.buildArgs(launchOpts);
			const escapedWorktreePath = worktreePath.replace(/'/g, "'\\''");
			writeFileSync(
				launchScript,
				`#!/bin/bash\ncd '${escapedWorktreePath}'\n${preset.command} ${launchArgs.join(" ")}\n`,
				{ mode: 0o755 }
			);

			return {
				success: true as const,
				promptPath,
				worktreePath,
				launchScript,
			};
		}),

	/**
	 * Reset a failed session: revert all commits and mark dismissed.
	 */
	resetFailedSession: publicProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ input }) => {
			const db = getDb();
			const session = db
				.select()
				.from(schema.commentSolveSessions)
				.where(eq(schema.commentSolveSessions.id, input.sessionId))
				.get();

			if (!session) throw new Error(`Session ${input.sessionId} not found`);
			if (session.status !== "failed") throw new Error("Session is not in failed state");

			let worktreePath: string | null = null;
			try {
				worktreePath = resolveSessionWorktree(input.sessionId).worktreePath;
			} catch {
				// Worktree may have been deleted — still allow dismiss
			}

			// Revert all non-reverted groups in reverse order
			if (worktreePath) {
				const groups = db
					.select()
					.from(schema.commentGroups)
					.where(eq(schema.commentGroups.solveSessionId, input.sessionId))
					.orderBy(schema.commentGroups.order)
					.all();

				// Revert in reverse order (highest order first)
				const groupsToRevert = groups
					.filter((g) => (g.status === "fixed" || g.status === "approved") && g.commitHash)
					.reverse();

				for (const group of groupsToRevert) {
					try {
						await revertGroupOrchestrator(group.id, worktreePath);
					} catch (err) {
						console.error(`[comment-solver] Failed to revert group ${group.id}:`, err);
						// Continue reverting remaining groups
					}
				}
			}

			db.update(schema.commentSolveSessions)
				.set({ status: "dismissed", updatedAt: new Date() })
				.where(eq(schema.commentSolveSessions.id, input.sessionId))
				.run();

			return { success: true };
		}),

	/**
	 * Keep partial changes from a failed session: transition directly to ready.
	 */
	keepFailedSession: publicProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			const session = db
				.select()
				.from(schema.commentSolveSessions)
				.where(eq(schema.commentSolveSessions.id, input.sessionId))
				.get();

			if (!session) throw new Error(`Session ${input.sessionId} not found`);
			if (session.status !== "failed") throw new Error("Session is not in failed state");

			db.update(schema.commentSolveSessions)
				.set({ status: "ready", updatedAt: new Date() })
				.where(eq(schema.commentSolveSessions.id, input.sessionId))
				.run();

			return { success: true };
		}),
});
