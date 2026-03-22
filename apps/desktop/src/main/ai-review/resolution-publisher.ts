import { execSync } from "node:child_process";
import { and, desc, eq } from "drizzle-orm";
import { replyToPRComment } from "../atlassian/bitbucket";
import { getDb } from "../db";
import { resolutionComments, resolutionGroups, resolutionSessions } from "../db/schema-resolution";
import { addReviewThreadReply, resolveThread } from "../github/github";
import { getSettings } from "./orchestrator";

// ─── Types ────────────────────────────────────────────────────────────────────

type ResolutionComment = typeof resolutionComments.$inferSelect;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Group resolution comments by their platform thread ID (GitHub) or fall back
 * to platformCommentId (Bitbucket, which has no thread concept).
 */
export function groupRepliesByThread(
	comments: ResolutionComment[]
): Record<string, ResolutionComment[]> {
	const groups: Record<string, ResolutionComment[]> = {};

	for (const comment of comments) {
		const key = comment.platformThreadId ?? comment.platformCommentId;
		if (!groups[key]) {
			groups[key] = [];
		}
		groups[key].push(comment);
	}

	return groups;
}

// ─── PR identifier parser ─────────────────────────────────────────────────────

function parsePrIdentifier(identifier: string): {
	ownerOrWorkspace: string;
	repo: string;
	number: number;
} {
	const [ownerRepo, numStr] = identifier.split("#");
	const [ownerOrWorkspace, repo] = ownerRepo!.split("/");
	return {
		ownerOrWorkspace: ownerOrWorkspace!,
		repo: repo!,
		number: Number.parseInt(numStr!, 10),
	};
}

// ─── Push and reply ───────────────────────────────────────────────────────────

export interface PushAndReplyParams {
	sessionId: string;
	groupId: string;
	worktreePath: string;
	replyBody: string;
}

export interface PushAndReplyResult {
	pushed: boolean;
	replied: boolean;
	errors: string[];
}

/**
 * Push git changes for a resolution group and post replies to the platform.
 * Respects `postReplyOnPush` and `autoResolveThreads` settings.
 */
export async function pushAndReply(params: PushAndReplyParams): Promise<PushAndReplyResult> {
	const { sessionId, groupId, worktreePath, replyBody } = params;
	const db = getDb();
	const errors: string[] = [];
	let pushed = false;
	let replied = false;

	// Push
	try {
		execSync("git push", { cwd: worktreePath, stdio: "pipe" });
		pushed = true;
	} catch (err) {
		errors.push(`git push failed: ${err}`);
		return { pushed, replied, errors };
	}

	// Check settings before replying
	const settings = getSettings();
	if (!settings.postReplyOnPush) {
		return { pushed, replied, errors };
	}

	// Fetch session to get provider + PR identifier
	const session = db
		.select()
		.from(resolutionSessions)
		.where(eq(resolutionSessions.id, sessionId))
		.get();

	if (!session) {
		errors.push(`Session ${sessionId} not found`);
		return { pushed, replied, errors };
	}

	// Fetch comments for this group
	const groupComments = db
		.select()
		.from(resolutionComments)
		.where(eq(resolutionComments.groupId, groupId))
		.all();

	if (groupComments.length === 0) {
		return { pushed, replied, errors };
	}

	const { ownerOrWorkspace, repo, number: prNumber } = parsePrIdentifier(session.prIdentifier);
	const threadGroups = groupRepliesByThread(groupComments);

	for (const [threadKey, comments] of Object.entries(threadGroups)) {
		const representative = comments[0];
		if (!representative) continue;

		try {
			if (session.prProvider === "github") {
				// threadKey is platformThreadId for GitHub
				await addReviewThreadReply({ threadId: threadKey, body: replyBody });

				if (settings.autoResolveThreads) {
					await resolveThread(threadKey);
				}
			} else if (session.prProvider === "bitbucket") {
				// threadKey is platformCommentId for Bitbucket
				const parentId = Number.parseInt(representative.platformCommentId, 10);
				await replyToPRComment(ownerOrWorkspace, repo, prNumber, parentId, replyBody);
			}
			replied = true;
		} catch (err) {
			errors.push(`Failed to reply to thread ${threadKey}: ${err}`);
		}
	}

	return { pushed, replied, errors };
}

// ─── Revert group ─────────────────────────────────────────────────────────────

/**
 * Revert a single resolution group: runs `git revert --no-edit <sha>`,
 * sets the group status to "reverted", and moves its comments back to "pending".
 */
export async function revertGroup(groupId: string, worktreePath: string): Promise<void> {
	const db = getDb();
	const now = new Date();

	const group = db.select().from(resolutionGroups).where(eq(resolutionGroups.id, groupId)).get();

	if (!group) throw new Error(`Resolution group ${groupId} not found`);

	execSync(`git revert --no-edit ${group.commitSha}`, { cwd: worktreePath, stdio: "pipe" });

	db.update(resolutionGroups)
		.set({ status: "reverted", updatedAt: now })
		.where(eq(resolutionGroups.id, groupId))
		.run();

	db.update(resolutionComments)
		.set({ status: "pending", updatedAt: now })
		.where(eq(resolutionComments.groupId, groupId))
		.run();
}

// ─── Revert all ───────────────────────────────────────────────────────────────

/**
 * Revert all applied resolution groups for a session in reverse chronological
 * order (most recent first).
 */
export async function revertAll(sessionId: string, worktreePath: string): Promise<void> {
	const db = getDb();

	const appliedGroups = db
		.select()
		.from(resolutionGroups)
		.where(and(eq(resolutionGroups.sessionId, sessionId), eq(resolutionGroups.status, "applied")))
		.orderBy(desc(resolutionGroups.createdAt))
		.all();

	for (const group of appliedGroups) {
		await revertGroup(group.id, worktreePath);
	}
}
