import { execSync } from "node:child_process";
import { and, eq } from "drizzle-orm";
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

/** Push commits and post approved replies to GitHub/Bitbucket */
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

	try {
		execSync("git push --set-upstream origin HEAD", { cwd: worktree.path, stdio: "pipe" });
		pushed = true;
	} catch (err) {
		errors.push(`Git push failed: ${err}`);
		// Continue — still try to post replies even if push fails
	}
	const approvedReplies = db
		.select({
			reply: schema.commentReplies,
			comment: schema.prComments,
		})
		.from(schema.commentReplies)
		.innerJoin(schema.prComments, eq(schema.commentReplies.prCommentId, schema.prComments.id))
		.where(
			and(
				eq(schema.prComments.solveSessionId, sessionId),
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
			return reply.id;
		})
	);

	for (const result of replyResults) {
		if (result.status === "fulfilled") {
			repliesPosted++;
		} else {
			errors.push(`Failed to post reply: ${result.reason}`);
		}
	}

	// Resolve threads for fixed comments (now works for both providers)
	const fixedComments = db
		.select()
		.from(schema.prComments)
		.where(
			and(eq(schema.prComments.solveSessionId, sessionId), eq(schema.prComments.status, "fixed"))
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

	for (const result of resolveResults) {
		if (result.status === "fulfilled") {
			threadsResolved++;
		} else {
			console.error("[solve-publisher] Failed to resolve thread:", result.reason);
			errors.push(`Failed to resolve thread: ${result.reason}`);
		}
	}

	validateSolveTransition(session.status, "submitted");
	db.update(schema.commentSolveSessions)
		.set({ status: "submitted", updatedAt: new Date() })
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.run();

	return { pushed, repliesPosted, threadsResolved, errors };
}
