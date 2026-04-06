import { randomUUID } from "node:crypto";
import { and, eq, inArray, not } from "drizzle-orm";
import { z } from "zod";
import { revertGroup as revertGroupOrchestrator } from "../../ai-review/comment-solver-orchestrator";
import { createAndQueueSolve } from "../../ai-review/create-and-queue-solve";
import { parsePrIdentifier } from "../../ai-review/pr-identifier";
import { publishSolve } from "../../ai-review/solve-publisher";
import { resolveSessionWorktree } from "../../ai-review/solve-session-resolver";
import { getBitbucketPRComments } from "../../atlassian/bitbucket";
import { getDb } from "../../db";
import * as schema from "../../db/schema";
import { getPRComments } from "../../github/github";
import type {
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
	 * Fetch live PR comments for a workspace's linked PR.
	 * Returns raw platform comments without any session context.
	 */
	getWorkspaceComments: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.query(async ({ input }) => {
			const db = getDb();

			const workspace = db
				.select()
				.from(schema.workspaces)
				.where(eq(schema.workspaces.id, input.workspaceId))
				.get();

			if (!workspace || !workspace.prProvider || !workspace.prIdentifier) {
				return [];
			}

			const { owner, repo, number: prNumber } = parsePrIdentifier(workspace.prIdentifier);

			type WorkspaceComment = {
				platformId: string;
				author: string;
				body: string;
				filePath: string | null;
				lineNumber: number | null;
				createdAt: string;
			};

			if (workspace.prProvider === "github") {
				const ghComments = await getPRComments(owner, repo, prNumber);
				return ghComments.map(
					(c): WorkspaceComment => ({
						platformId: String(c.id),
						author: c.author,
						body: c.body,
						filePath: c.path ?? null,
						lineNumber: c.line ?? null,
						createdAt: c.createdAt,
					})
				);
			} else if (workspace.prProvider === "bitbucket") {
				const bbComments = await getBitbucketPRComments(owner, repo, prNumber);
				return bbComments.map(
					(c): WorkspaceComment => ({
						platformId: String(c.id),
						author: c.author,
						body: c.body,
						filePath: c.filePath,
						lineNumber: c.lineNumber,
						createdAt: c.createdAt,
					})
				);
			}

			return [];
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
	 * Update a comment reply's body and/or status.
	 */
	updateReply: publicProcedure
		.input(
			z.object({
				replyId: z.string(),
				body: z.string().optional(),
				status: z.enum(["approved"]).optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const updates: Record<string, unknown> = {};
			if (input.body !== undefined) updates.body = input.body;
			if (input.status !== undefined) updates.status = input.status;

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
	 * Add a new draft reply to a comment.
	 */
	addReply: publicProcedure
		.input(z.object({ commentId: z.string(), body: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			const id = randomUUID();
			db.insert(schema.commentReplies)
				.values({
					id,
					prCommentId: input.commentId,
					body: input.body,
					status: "draft",
				})
				.run();
			return { id, success: true };
		}),

	/**
	 * Push commits and post approved replies to the platform.
	 * Validates all groups are approved and all replies are resolved first.
	 */
	pushAndPost: publicProcedure
		.input(z.object({ sessionId: z.string() }))
		.mutation(async ({ input }) => {
			const db = getDb();

			// Validate all non-reverted groups are "approved"
			const groups = db
				.select()
				.from(schema.commentGroups)
				.where(eq(schema.commentGroups.solveSessionId, input.sessionId))
				.all();

			const unapprovedGroups = groups.filter(
				(g) => g.status !== "approved" && g.status !== "reverted"
			);
			if (unapprovedGroups.length > 0) {
				throw new Error(`Cannot publish: ${unapprovedGroups.length} group(s) not yet approved`);
			}

			// Validate no draft replies remain
			const sessionComments = db
				.select({ id: schema.prComments.id })
				.from(schema.prComments)
				.where(eq(schema.prComments.solveSessionId, input.sessionId))
				.all();

			const commentIds = sessionComments.map((c) => c.id);

			if (commentIds.length > 0) {
				const draftReplies = db
					.select()
					.from(schema.commentReplies)
					.where(
						and(
							inArray(schema.commentReplies.prCommentId, commentIds),
							eq(schema.commentReplies.status, "draft")
						)
					)
					.all();

				if (draftReplies.length > 0) {
					throw new Error(
						`Cannot publish: ${draftReplies.length} reply draft(s) still pending approval`
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
});
