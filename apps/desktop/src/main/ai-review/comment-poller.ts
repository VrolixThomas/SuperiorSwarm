import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { getGitProvider } from "../providers/git-provider";
import { createAndQueueSolve } from "./create-and-queue-solve";
import { getSettings } from "./orchestrator";
import { parsePrIdentifier } from "./pr-identifier";
import { getCachedPRs } from "./pr-poller";

const POLL_INTERVAL_MS = 60_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;

// ── Known comment IDs from DB ────────────────────────────────────────────────

function getKnownPlatformCommentIds(prIdentifier: string): Set<string> {
	const db = getDb();

	const sessions = db
		.select({ id: schema.commentSolveSessions.id })
		.from(schema.commentSolveSessions)
		.where(eq(schema.commentSolveSessions.prIdentifier, prIdentifier))
		.all();

	if (sessions.length === 0) return new Set();

	const sessionIds = sessions.map((s) => s.id);

	const comments = db
		.select({ platformCommentId: schema.prComments.platformCommentId })
		.from(schema.prComments)
		.where(inArray(schema.prComments.solveSessionId, sessionIds))
		.all();

	return new Set(comments.map((c) => c.platformCommentId));
}

// ── Count active solve sessions ─────────────────────────────────────────────

function getActiveSolveCount(): number {
	const db = getDb();
	const result = db
		.select({ id: schema.commentSolveSessions.id })
		.from(schema.commentSolveSessions)
		.where(inArray(schema.commentSolveSessions.status, ["queued", "in_progress"]))
		.all();
	return result.length;
}

// ── Poll a single workspace ──────────────────────────────────────────────────

export async function pollWorkspace(workspace: schema.Workspace): Promise<void> {
	const { id: workspaceId, prProvider, prIdentifier } = workspace;
	if (!prProvider || !prIdentifier) return;

	const git = getGitProvider(prProvider);
	if (!git.isConnected()) return;

	const { owner, repo, number } = parsePrIdentifier(prIdentifier);
	const db = getDb();

	// Load cached cacheKey (ETag or updated_on) for this workspace
	const meta = db
		.select()
		.from(schema.prCommentCacheMeta)
		.where(eq(schema.prCommentCacheMeta.workspaceId, workspaceId))
		.get();

	let result: Awaited<ReturnType<typeof git.getPRCommentsIfChanged>>;
	try {
		result = await git.getPRCommentsIfChanged(owner, repo, number, meta?.cacheKey ?? undefined);
	} catch (err) {
		console.error(`[comment-poller] Failed to fetch comments for ${prIdentifier}:`, err);
		return;
	}

	if (!result.changed) return; // Nothing new — skip all DB writes

	const now = new Date();
	const { comments, cacheKey } = result;

	// Replace cache for this workspace atomically
	try {
		db.transaction((tx) => {
			tx.delete(schema.prCommentCache)
				.where(eq(schema.prCommentCache.workspaceId, workspaceId))
				.run();

			for (const c of comments) {
				tx.insert(schema.prCommentCache)
					.values({
						id: randomUUID(),
						workspaceId,
						platformCommentId: c.id,
						author: c.author,
						body: c.body,
						filePath: c.filePath ?? null,
						lineNumber: c.lineNumber ?? null,
						side: c.side ?? null,
						createdAt: c.createdAt,
						fetchedAt: now,
					})
					.run();
			}

			tx.insert(schema.prCommentCacheMeta)
				.values({ workspaceId, cacheKey, fetchedAt: now })
				.onConflictDoUpdate({
					target: schema.prCommentCacheMeta.workspaceId,
					set: { cacheKey, fetchedAt: now },
				})
				.run();
		});
	} catch (err) {
		console.error(`[comment-poller] Failed to update comment cache for ${prIdentifier}:`, err);
		return;
	}

	// Detect new comments vs what's in solved sessions
	const commentIds = comments.map((c) => c.id);
	const knownIds = getKnownPlatformCommentIds(prIdentifier);
	const newCommentIds = commentIds.filter((id) => !knownIds.has(id));

	if (newCommentIds.length === 0) return;

	console.log(
		`[comment-poller] ${newCommentIds.length} new comment(s) on ${prIdentifier} (workspace ${workspaceId})`
	);

	// Upsert comment event (existing logic — unchanged)
	const existing = db
		.select()
		.from(schema.commentEvents)
		.where(
			and(
				eq(schema.commentEvents.prIdentifier, prIdentifier),
				eq(schema.commentEvents.status, "pending")
			)
		)
		.get();

	if (existing) {
		db.update(schema.commentEvents)
			.set({ commentCount: newCommentIds.length, createdAt: now })
			.where(eq(schema.commentEvents.id, existing.id))
			.run();
	} else {
		db.insert(schema.commentEvents)
			.values({
				id: randomUUID(),
				prProvider,
				prIdentifier,
				workspaceId,
				commentCount: newCommentIds.length,
				status: "pending",
				createdAt: now,
			})
			.run();
	}

	// Auto-solve if enabled (existing logic — unchanged)
	const settings = getSettings();
	if (!settings.autoSolveEnabled) return;

	const activeCount = getActiveSolveCount();
	if (activeCount >= settings.maxConcurrentReviews) {
		console.log(
			`[comment-poller] Skipping auto-solve for ${prIdentifier}: at concurrency limit (${activeCount}/${settings.maxConcurrentReviews})`
		);
		return;
	}

	const eventToSolve = db
		.select()
		.from(schema.commentEvents)
		.where(
			and(
				eq(schema.commentEvents.prIdentifier, prIdentifier),
				eq(schema.commentEvents.status, "pending")
			)
		)
		.get();

	if (!eventToSolve) return;

	db.update(schema.commentEvents)
		.set({ status: "auto_solving" })
		.where(eq(schema.commentEvents.id, eventToSolve.id))
		.run();

	try {
		await createAndQueueSolve({ workspaceId });
		db.update(schema.commentEvents)
			.set({ status: "dismissed" })
			.where(eq(schema.commentEvents.id, eventToSolve.id))
			.run();
		console.log(`[comment-poller] Auto-solve triggered for ${prIdentifier}`);
	} catch (err) {
		console.error(`[comment-poller] Auto-solve failed for ${prIdentifier}:`, err);
		db.update(schema.commentEvents)
			.set({ status: "pending" })
			.where(eq(schema.commentEvents.id, eventToSolve.id))
			.run();
	}
}

// ── Reconcile unlinked workspaces with PR cache ─────────────────────────────

function reconcileUnlinkedWorkspaces(): void {
	const db = getDb();

	const unlinked = db
		.select()
		.from(schema.workspaces)
		.where(and(eq(schema.workspaces.type, "worktree"), isNull(schema.workspaces.prProvider)))
		.all();

	if (unlinked.length === 0) return;

	for (const ws of unlinked) {
		if (!ws.worktreeId) continue;

		const worktree = db
			.select()
			.from(schema.worktrees)
			.where(eq(schema.worktrees.id, ws.worktreeId))
			.get();

		if (!worktree) continue;

		const cachedPRs = getCachedPRs(ws.projectId);
		const match = cachedPRs.find(
			(pr) => pr.sourceBranch === worktree.branch && pr.state === "open"
		);

		if (match) {
			console.log(`[comment-poller] Auto-linked workspace "${ws.name}" to PR ${match.identifier}`);
			db.update(schema.workspaces)
				.set({
					prProvider: match.provider,
					prIdentifier: match.identifier,
					updatedAt: new Date(),
				})
				.where(eq(schema.workspaces.id, ws.id))
				.run();
		}
	}
}

// ── Core poll cycle ──────────────────────────────────────────────────────────

async function doPoll(): Promise<void> {
	const db = getDb();

	reconcileUnlinkedWorkspaces();

	const allWorkspaces = db
		.select()
		.from(schema.workspaces)
		.where(eq(schema.workspaces.type, "worktree"))
		.all();

	const linked = allWorkspaces.filter((ws) => ws.prProvider !== null && ws.prIdentifier !== null);

	if (linked.length === 0) return;

	for (const workspace of linked) {
		try {
			await pollWorkspace(workspace);
		} catch (err) {
			console.error(
				`[comment-poller] Error polling workspace ${workspace.id} (${workspace.prIdentifier}):`,
				err
			);
		}
	}
}

// ── Public control API ───────────────────────────────────────────────────────

export function startCommentPoller(): void {
	if (pollTimer) return;

	console.log("[comment-poller] Starting background comment polling");
	doPoll().catch((err) => console.error("[comment-poller] Initial poll error:", err));
	pollTimer = setInterval(() => {
		doPoll().catch((err) => console.error("[comment-poller] Poll cycle error:", err));
	}, POLL_INTERVAL_MS);
}

export function stopCommentPoller(): void {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
		console.log("[comment-poller] Stopped");
	}
}
