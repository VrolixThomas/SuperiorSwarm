import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { SolveLaunchInfo } from "../../shared/solve-types";
import { currentPRScope } from "../activity-queue/pr-scope";
import { getDb } from "../db";
import * as schema from "../db/schema";
import type { NormalizedComment } from "../providers/types";
import { queueSolve } from "./comment-solver-orchestrator";
import { getCachedPRs } from "./pr-poller";

export async function createAndQueueSolve(params: {
	workspaceId: string;
	excludeCommentIds?: string[];
	/** Complete fresh comments supplied by guarded Queue admission; never fall back to cache. */
	comments?: readonly (NormalizedComment & { threadId?: string | null })[];
	queueOccurrence?: { id: string; revision: number };
	expectedAccountId?: string;
}): Promise<SolveLaunchInfo> {
	const db = getDb();

	// 1. Fetch workspace
	let workspace = db
		.select()
		.from(schema.workspaces)
		.where(eq(schema.workspaces.id, params.workspaceId))
		.get();

	if (!workspace) throw new Error(`Workspace ${params.workspaceId} not found`);

	// Auto-detect PR if not linked yet
	if (!workspace.prProvider || !workspace.prIdentifier) {
		if (!workspace.worktreeId) throw new Error("Workspace has no worktree linked");
		const wt = db
			.select()
			.from(schema.worktrees)
			.where(eq(schema.worktrees.id, workspace.worktreeId))
			.get();
		if (!wt) throw new Error("Worktree not found");

		const cached = getCachedPRs(workspace.projectId);
		const match = cached.find((pr) => pr.sourceBranch === wt.branch && pr.state === "open");
		if (!match) {
			throw new Error(
				`No open PR found for branch "${wt.branch}". Make sure a pull request exists and the PR poller has run.`
			);
		}

		db.update(schema.workspaces)
			.set({
				prProvider: match.provider,
				prIdentifier: match.identifier,
				updatedAt: new Date(),
			})
			.where(eq(schema.workspaces.id, workspace.id))
			.run();

		workspace = {
			...workspace,
			prProvider: match.provider,
			prIdentifier: match.identifier,
		};
	}

	const { prProvider, prIdentifier } = workspace;
	if (!prProvider || !prIdentifier) throw new Error("Workspace PR link is incomplete");

	// 2. Fetch worktree
	if (!workspace.worktreeId) throw new Error("Workspace has no worktree linked");
	const worktree = db
		.select()
		.from(schema.worktrees)
		.where(eq(schema.worktrees.id, workspace.worktreeId))
		.get();

	if (!worktree) throw new Error("Worktree not found for workspace");

	const account =
		prProvider === "github" || prProvider === "bitbucket" ? currentPRScope(prProvider) : null;
	if (params.expectedAccountId && account?.accountId !== params.expectedAccountId)
		throw new Error("The PR account changed before solver preparation.");
	const scope = account
		? JSON.stringify([
				workspace.id,
				prProvider,
				account.host,
				account.accountId,
				prIdentifier,
				...(params.queueOccurrence
					? [params.queueOccurrence.id, params.queueOccurrence.revision]
					: []),
			])
		: null;

	// Never delete an active session as implicit 'cleanup'. Recovery owns that lifecycle.
	if (
		db
			.select()
			.from(schema.commentSolveSessions)
			.where(
				and(
					eq(schema.commentSolveSessions.workspaceId, workspace.id),
					inArray(schema.commentSolveSessions.status, ["queued", "in_progress"])
				)
			)
			.get()
	)
		throw new Error("Another solve session is already active for this workspace");

	const cachedComments =
		params.comments ??
		db
			.select()
			.from(schema.prCommentCache)
			.where(eq(schema.prCommentCache.workspaceId, workspace.id))
			.all()
			.map((c) => ({
				id: c.platformCommentId,
				body: c.body,
				author: c.author,
				filePath: c.filePath,
				lineNumber: c.lineNumber,
				side: c.side,
				createdAt: c.createdAt,
			}));
	if (cachedComments.length === 0) throw new Error("No unresolved comments to solve.");
	const rawComments = cachedComments.map((c) => ({
		...c,
		threadId: "threadId" in c && typeof c.threadId === "string" ? c.threadId : null,
	}));

	// 5. Filter out comments already known in completed sessions
	const completedSessions = db
		.select({ id: schema.commentSolveSessions.id })
		.from(schema.commentSolveSessions)
		.where(
			and(
				eq(schema.commentSolveSessions.prIdentifier, prIdentifier),
				eq(schema.commentSolveSessions.workspaceId, workspace.id),
				eq(schema.commentSolveSessions.prProvider, prProvider),
				inArray(schema.commentSolveSessions.status, ["ready", "submitted"])
			)
		)
		.all();

	const completedSessionIds = completedSessions
		.filter((session) => {
			if (!scope) return false;
			const bound = db
				.select()
				.from(schema.sessionState)
				.where(eq(schema.sessionState.key, `comment-solve-scope:${session.id}`))
				.get();
			return bound?.value === scope;
		})
		.map((s) => s.id);

	let knownPlatformIds = new Set<string>();
	if (completedSessionIds.length > 0) {
		const knownComments = db
			.select({ platformCommentId: schema.prComments.platformCommentId })
			.from(schema.prComments)
			.where(inArray(schema.prComments.solveSessionId, completedSessionIds))
			.all();
		knownPlatformIds = new Set(knownComments.map((c) => c.platformCommentId));
	}

	const newComments = rawComments.filter((c) => !knownPlatformIds.has(String(c.id)));

	const commentsToInsert = newComments.filter(
		(c) => !params.excludeCommentIds?.includes(String(c.id))
	);

	if (commentsToInsert.length === 0) {
		throw new Error("No new unresolved comments to solve");
	}

	// 6. Create solve session + insert comments atomically
	const sessionId = randomUUID();
	const now = new Date();

	db.transaction((tx) => {
		tx.insert(schema.commentSolveSessions)
			.values({
				id: sessionId,
				prProvider: prProvider,
				prIdentifier: prIdentifier,
				prTitle: workspace.name,
				sourceBranch: worktree.branch,
				targetBranch: worktree.baseBranch,
				status: "queued",
				workspaceId: workspace.id,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		if (scope)
			tx.insert(schema.sessionState)
				.values({
					key: `comment-solve-scope:${sessionId}`,
					value: scope,
				})
				.run();
		for (const comment of commentsToInsert) {
			tx.insert(schema.prComments)
				.values({
					id: randomUUID(),
					solveSessionId: sessionId,
					platformCommentId: String(comment.id),
					author: comment.author,
					body: comment.body,
					filePath: comment.filePath ?? "",
					lineNumber: comment.lineNumber ?? null,
					side: comment.side ?? null,
					threadId: comment.threadId ?? null,
					status: "open",
				})
				.run();
		}
	});

	// 7. Queue the solve job
	try {
		return await queueSolve(sessionId);
	} catch (err) {
		db.delete(schema.commentSolveSessions)
			.where(eq(schema.commentSolveSessions.id, sessionId))
			.run();
		throw err;
	}
}
