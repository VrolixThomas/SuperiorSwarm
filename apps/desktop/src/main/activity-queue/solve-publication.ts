import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { QueuePROrigin, QueuePRPublication } from "../../shared/queue-pr-publication";
import { getSettings } from "../ai-review/orchestrator";
import { resolveSessionWorktree } from "../ai-review/solve-session-resolver";
import { getDb } from "../db";
import { commentGroups, commentReplies, prComments } from "../db/schema";
import { queueSolveOrigin } from "./solve-queue-origin";
export function solvePublicationSnapshot(
	origin: QueuePROrigin,
	operation: Extract<QueuePRPublication, { kind: "solve" }>
) {
	const context = queueSolveOrigin(operation.sessionId);
	if (!context || context.origin.id !== origin.id || context.origin.revision !== origin.revision)
		throw new Error("Solver does not belong to this queue occurrence.");
	const resolved = resolveSessionWorktree(operation.sessionId);
	if (
		resolved.workspace.prProvider !== resolved.session.prProvider ||
		resolved.workspace.prIdentifier !== resolved.session.prIdentifier ||
		resolved.worktree.projectId !== resolved.workspace.projectId
	)
		throw new Error("Solver workspace link changed.");
	const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
		cwd: resolved.worktreePath,
		encoding: "utf8",
	}).trim();
	if (branch !== resolved.session.sourceBranch)
		throw new Error("Solver branch changed before publication.");
	const groups = getDb()
		.select()
		.from(commentGroups)
		.where(eq(commentGroups.solveSessionId, operation.sessionId))
		.all()
		.filter((group) =>
			operation.groupId ? group.id === operation.groupId : group.status === "approved"
		)
		.sort((a, b) => a.id.localeCompare(b.id));
	if (!groups.length || groups.some((group) => group.status !== "approved"))
		throw new Error("Approve the intended solver groups before publishing.");
	const comments = getDb()
		.select()
		.from(prComments)
		.where(
			inArray(
				prComments.groupId,
				groups.map((group) => group.id)
			)
		)
		.all()
		.sort((a, b) => a.id.localeCompare(b.id));
	const replies = comments.length
		? getDb()
				.select()
				.from(commentReplies)
				.where(
					inArray(
						commentReplies.prCommentId,
						comments.map((comment) => comment.id)
					)
				)
				.all()
				.sort((a, b) => a.id.localeCompare(b.id))
		: [];
	if (replies.some((reply) => reply.status === "draft"))
		throw new Error("Review the remaining draft replies before publishing.");
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: resolved.worktreePath,
		encoding: "utf8",
	}).trim();
	const remote = execFileSync("git", ["remote", "get-url", "origin"], {
		cwd: resolved.worktreePath,
		encoding: "utf8",
	}).trim();
	let destination: string;
	try {
		const url = new URL(remote);
		destination = `${url.hostname}${url.pathname}`;
	} catch {
		const ssh = remote.match(/^[^@]+@([^:]+):(.+)$/);
		destination = ssh ? `${ssh[1]}/${ssh[2]}` : "";
	}
	if (
		destination.replace(/\.git$/, "").toLowerCase() !==
		`${context.host}/${context.prCtx.owner}/${context.prCtx.repo}`.toLowerCase()
	)
		throw new Error("The worktree push remote does not match this queue PR.");
	const signature = createHash("sha256")
		.update(
			JSON.stringify([
				context,
				head,
				remote,
				groups,
				comments,
				replies,
				getSettings().solveAutoResolveThreads,
			])
		)
		.digest("hex");
	return { context, head, signature, comments, replies };
}
