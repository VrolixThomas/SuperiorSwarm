import { execSync } from "node:child_process";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { getGitProvider } from "../providers/git-provider";
import { validateSolveTransition } from "./comment-solver-orchestrator";
import { parsePrIdentifier } from "./pr-identifier";
import { resolveSessionWorktree } from "./solve-session-resolver";

export interface PublishSolveResult {
	pushed: boolean;
	repliesPosted: number;
	threadsResolved: number;
	errors: string[];
}

/** Push commits and post approved replies for a single group. */
export async function publishGroup(groupId: string): Promise<PublishSolveResult> {
	const db = getDb();
	const errors: string[] = [];
	let pushed = false;
	let repliesPosted = 0;
	let threadsResolved = 0;

	const group = db
		.select()
		.from(schema.commentGroups)
		.where(eq(schema.commentGroups.id, groupId))
		.get();
	if (!group) throw new Error(`Group ${groupId} not found`);

	let resolved: ReturnType<typeof resolveSessionWorktree>;
	try {
		resolved = resolveSessionWorktree(group.solveSessionId);
	} catch (err) {
		return { pushed: false, repliesPosted: 0, threadsResolved: 0, errors: [String(err)] };
	}
	const { session, worktree } = resolved;

	try {
		execSync("git push --set-upstream origin HEAD", { cwd: worktree.path, stdio: "pipe" });
		pushed = true;
	} catch (err) {
		errors.push(`Git push failed: ${err}`);
	}

	const { owner, repo, number: prNumber } = parsePrIdentifier(session.prIdentifier);
	const git = getGitProvider(session.prProvider);

	// Post approved replies for this group's comments only
	const groupCommentIds = db
		.select({ id: schema.prComments.id })
		.from(schema.prComments)
		.where(eq(schema.prComments.groupId, groupId))
		.all()
		.map((c) => c.id);

	if (groupCommentIds.length > 0) {
		const approvedReplies = db
			.select({ reply: schema.commentReplies, comment: schema.prComments })
			.from(schema.commentReplies)
			.innerJoin(schema.prComments, eq(schema.commentReplies.prCommentId, schema.prComments.id))
			.where(
				and(
					inArray(schema.commentReplies.prCommentId, groupCommentIds),
					eq(schema.commentReplies.status, "approved")
				)
			)
			.all();

		const replyResults = await Promise.allSettled(
			approvedReplies.map(async ({ reply, comment }) => {
				await git.replyToComment({
					owner,
					repo,
					prNumber,
					commentId: comment.threadId ?? comment.platformCommentId,
					body: reply.body,
				});
				db.update(schema.commentReplies)
					.set({ status: "posted" })
					.where(eq(schema.commentReplies.id, reply.id))
					.run();
			})
		);
		for (const r of replyResults) {
			if (r.status === "fulfilled") repliesPosted++;
			else errors.push(`Failed to post reply: ${r.reason}`);
		}

		// Resolve threads for fixed comments in this group
		const fixedComments = db
			.select()
			.from(schema.prComments)
			.where(
				and(
					inArray(schema.prComments.id, groupCommentIds),
					eq(schema.prComments.status, "fixed")
				)
			)
			.all();

		const resolveResults = await Promise.allSettled(
			fixedComments.map((comment) =>
				git.resolveComment({
					owner,
					repo,
					prNumber,
					commentId: comment.threadId ?? comment.platformCommentId,
				})
			)
		);
		for (const r of resolveResults) {
			if (r.status === "fulfilled") threadsResolved++;
			else errors.push(`Failed to resolve thread: ${r.reason}`);
		}
	}

	// Mark group submitted
	db.update(schema.commentGroups)
		.set({ status: "submitted" })
		.where(eq(schema.commentGroups.id, groupId))
		.run();

	// If all non-reverted groups are now submitted, mark the session submitted too
	const allGroups = db
		.select()
		.from(schema.commentGroups)
		.where(eq(schema.commentGroups.solveSessionId, group.solveSessionId))
		.all();
	const allSubmitted = allGroups
		.filter((g) => g.status !== "reverted")
		.every((g) => g.id === groupId || g.status === "submitted");
	if (allSubmitted) {
		validateSolveTransition(session.status, "submitted");
		db.update(schema.commentSolveSessions)
			.set({ status: "submitted", updatedAt: new Date() })
			.where(eq(schema.commentSolveSessions.id, group.solveSessionId))
			.run();
	}

	return { pushed, repliesPosted, threadsResolved, errors };
}

/** Push all approved-but-not-yet-submitted groups in one shot. */
export async function publishSolve(sessionId: string): Promise<PublishSolveResult> {
	const db = getDb();
	const errors: string[] = [];
	let pushed = false;
	let repliesPosted = 0;
	let threadsResolved = 0;

	let resolved: ReturnType<typeof resolveSessionWorktree>;
	try {
		resolved = resolveSessionWorktree(sessionId);
	} catch (err) {
		return { pushed: false, repliesPosted: 0, threadsResolved: 0, errors: [String(err)] };
	}
	const { session, worktree } = resolved;

	// One git push for all groups
	try {
		execSync("git push --set-upstream origin HEAD", { cwd: worktree.path, stdio: "pipe" });
		pushed = true;
	} catch (err) {
		errors.push(`Git push failed: ${err}`);
	}

	// Only publish groups that are approved (not already submitted/reverted)
	const approvedGroups = db
		.select()
		.from(schema.commentGroups)
		.where(
			and(eq(schema.commentGroups.solveSessionId, sessionId), eq(schema.commentGroups.status, "approved"))
		)
		.all();

	const approvedGroupIds = approvedGroups.map((g) => g.id);

	if (approvedGroupIds.length > 0) {
		const approvedReplies = db
			.select({ reply: schema.commentReplies, comment: schema.prComments })
			.from(schema.commentReplies)
			.innerJoin(schema.prComments, eq(schema.commentReplies.prCommentId, schema.prComments.id))
			.where(
				and(
					inArray(schema.prComments.groupId, approvedGroupIds),
					eq(schema.commentReplies.status, "approved")
				)
			)
			.all();

		const { owner, repo, number: prNumber } = parsePrIdentifier(session.prIdentifier);
		const git = getGitProvider(session.prProvider);

		const replyResults = await Promise.allSettled(
			approvedReplies.map(async ({ reply, comment }) => {
				await git.replyToComment({
					owner,
					repo,
					prNumber,
					commentId: comment.threadId ?? comment.platformCommentId,
					body: reply.body,
				});
				db.update(schema.commentReplies)
					.set({ status: "posted" })
					.where(eq(schema.commentReplies.id, reply.id))
					.run();
			})
		);
		for (const r of replyResults) {
			if (r.status === "fulfilled") repliesPosted++;
			else errors.push(`Failed to post reply: ${r.reason}`);
		}

		const fixedComments = db
			.select()
			.from(schema.prComments)
			.where(
				and(
					inArray(schema.prComments.groupId, approvedGroupIds),
					eq(schema.prComments.status, "fixed")
				)
			)
			.all();

		const resolveResults = await Promise.allSettled(
			fixedComments.map((comment) =>
				git.resolveComment({
					owner,
					repo,
					prNumber,
					commentId: comment.threadId ?? comment.platformCommentId,
				})
			)
		);
		for (const r of resolveResults) {
			if (r.status === "fulfilled") threadsResolved++;
			else errors.push(`Failed to resolve thread: ${r.reason}`);
		}

		// Mark all approved groups as submitted
		db.update(schema.commentGroups)
			.set({ status: "submitted" })
			.where(inArray(schema.commentGroups.id, approvedGroupIds))
			.run();
	}

	// If all non-reverted groups are now submitted, mark session submitted
	const allGroups = db
		.select()
		.from(schema.commentGroups)
		.where(eq(schema.commentGroups.solveSessionId, sessionId))
		.all();
	const allSubmitted = allGroups
		.filter((g) => g.status !== "reverted")
		.every((g) => g.status === "submitted" || approvedGroupIds.includes(g.id));
	if (allSubmitted) {
		validateSolveTransition(session.status, "submitted");
		db.update(schema.commentSolveSessions)
			.set({ status: "submitted", updatedAt: new Date() })
			.where(eq(schema.commentSolveSessions.id, sessionId))
			.run();
	}

	return { pushed, repliesPosted, threadsResolved, errors };
}
