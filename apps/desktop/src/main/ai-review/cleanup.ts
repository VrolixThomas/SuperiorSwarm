import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { workspaces } from "../db/schema";
import { reviewDrafts } from "../db/schema-ai-review";
import { removeWorkspace } from "../services/workspace-service";
import { validateTransition } from "./orchestrator";

/**
 * Full cleanup of a review workspace: atomically tombstones the workspace and
 * queues its worktree for the detached cleanup daemon, then dismisses drafts.
 * Used by: dismissReview, PR close detection, commit-poller on merge.
 */
export async function cleanupReviewWorkspace(workspaceId: string): Promise<void> {
	const db = getDb();

	// 1. Find workspace + worktree + project (need project.repoPath for removeWorktree)
	const workspace = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
	if (!workspace) return;
	if (workspace.type !== "review") {
		throw new Error(`Cannot cleanup non-review workspace: ${workspaceId}`);
	}

	// Dismiss all related drafts for this PR before the workspace row disappears.
	if (workspace.prProvider && workspace.prIdentifier) {
		const drafts = db
			.select({ id: reviewDrafts.id, status: reviewDrafts.status })
			.from(reviewDrafts)
			.where(eq(reviewDrafts.prIdentifier, workspace.prIdentifier))
			.all();
		for (const draft of drafts) {
			try {
				validateTransition(draft.status, "dismissed");
				db.update(reviewDrafts)
					.set({ status: "dismissed" })
					.where(eq(reviewDrafts.id, draft.id))
					.run();
			} catch {
				// Skip drafts already in a terminal state that doesn't allow dismissed
			}
		}
	}

	await removeWorkspace({
		workspaceId,
		projectId: workspace.projectId,
		force: true,
	});
}

/**
 * Find workspace ID for a given PR. Optionally scoped to a project.
 * Used by pollers.
 */
export function findReviewWorkspaceByPR(
	prProvider: string,
	prIdentifier: string,
	projectId?: string
): string | undefined {
	const db = getDb();

	const conditions = [
		eq(workspaces.prProvider, prProvider),
		eq(workspaces.prIdentifier, prIdentifier),
		eq(workspaces.type, "review"),
	];

	if (projectId) {
		conditions.push(eq(workspaces.projectId, projectId));
	}

	const ws = db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(and(...conditions))
		.get();
	return ws?.id;
}
