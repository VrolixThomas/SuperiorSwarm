import { and, eq, inArray, isNull } from "drizzle-orm";
import { getAuth as getBitbucketAuth } from "../atlassian/auth";
import { getBitbucketPRComments } from "../atlassian/bitbucket";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { getValidToken } from "../github/auth";
import { getPRComments } from "../github/github";
import { parsePrIdentifier } from "./pr-identifier";
import { getCachedPRs } from "./pr-poller";

const POLL_INTERVAL_MS = 60_000;

export interface NewCommentsEvent {
	workspaceId: string;
	prProvider: string;
	prIdentifier: string;
	newCommentIds: string[];
}

type NewCommentsHandler = (event: NewCommentsEvent) => void;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let onNewCommentsHandler: NewCommentsHandler | null = null;

// ── Public event registration ───────────────────────────────────────────────

export function onNewCommentsDetected(handler: NewCommentsHandler): void {
	onNewCommentsHandler = handler;
}

// ── Fetch comments from platform ────────────────────────────────────────────

interface PlatformComment {
	platformId: string;
}

async function fetchGitHubComments(identifier: string): Promise<PlatformComment[]> {
	const { owner, repo, number } = parsePrIdentifier(identifier);
	const comments = await getPRComments(owner, repo, number);
	return comments.map((c) => ({ platformId: String(c.id) }));
}

async function fetchBitbucketComments(identifier: string): Promise<PlatformComment[]> {
	const { owner, repo, number } = parsePrIdentifier(identifier);
	const comments = await getBitbucketPRComments(owner, repo, number);
	return comments.map((c) => ({ platformId: String(c.id) }));
}

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

// ── Poll a single workspace ──────────────────────────────────────────────────

async function pollWorkspace(workspace: schema.Workspace): Promise<void> {
	const { id: workspaceId, prProvider, prIdentifier } = workspace;
	if (!prProvider || !prIdentifier) return;

	let platformComments: PlatformComment[];
	try {
		if (prProvider === "github") {
			if (!getValidToken()) return;
			platformComments = await fetchGitHubComments(prIdentifier);
		} else {
			if (!getBitbucketAuth("bitbucket")) return;
			platformComments = await fetchBitbucketComments(prIdentifier);
		}
	} catch (err) {
		console.error(`[comment-poller] Failed to fetch comments for ${prIdentifier}:`, err);
		return;
	}

	const knownIds = getKnownPlatformCommentIds(prIdentifier);

	const newCommentIds = platformComments.map((c) => c.platformId).filter((id) => !knownIds.has(id));

	if (newCommentIds.length === 0) return;

	console.log(
		`[comment-poller] ${newCommentIds.length} new comment(s) on ${prIdentifier} (workspace ${workspaceId})`
	);

	if (onNewCommentsHandler) {
		onNewCommentsHandler({ workspaceId, prProvider, prIdentifier, newCommentIds });
	}
}

// ── Reconcile unlinked workspaces with PR cache ─────────────────────────────

function reconcileUnlinkedWorkspaces(): void {
	const db = getDb();

	// Find worktree workspaces without a PR link
	const unlinked = db
		.select()
		.from(schema.workspaces)
		.where(and(eq(schema.workspaces.type, "worktree"), isNull(schema.workspaces.prProvider)))
		.all();

	if (unlinked.length === 0) return;

	// Get worktree records to match by branch name
	for (const ws of unlinked) {
		if (!ws.worktreeId) continue;

		const worktree = db
			.select()
			.from(schema.worktrees)
			.where(eq(schema.worktrees.id, ws.worktreeId))
			.get();

		if (!worktree) continue;

		// Check PR cache for a matching open authored PR
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

	// First, try to link any unlinked workspaces to their PRs
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
