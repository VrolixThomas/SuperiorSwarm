import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { projects, workspaces, worktrees } from "../db/schema";
import { reviewDrafts } from "../db/schema-ai-review";
import { removeWorktree } from "../git/operations";
import { validateTransition } from "./orchestrator";

/**
 * Full cleanup of a review workspace: removes worktree from disk,
 * deletes workspace record, dismisses all related drafts.
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

	const project = db.select().from(projects).where(eq(projects.id, workspace.projectId)).get();

	// 2. Remove worktree from disk if it exists
	if (workspace.worktreeId && project) {
		const worktree = db
			.select()
			.from(worktrees)
			.where(eq(worktrees.id, workspace.worktreeId))
			.get();
		if (worktree?.path) {
			try {
				// removeWorktree(repoPath, worktreePath) — needs both args
				await removeWorktree(project.repoPath, worktree.path);
			} catch {
				// Worktree may already be gone — that's fine
			}
		}
		// Delete worktree DB record
		db.delete(worktrees).where(eq(worktrees.id, workspace.worktreeId)).run();
	}

	// 3. Dismiss all related drafts for this PR
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

	// 4. Delete workspace record
	db.delete(workspaces).where(eq(workspaces.id, workspaceId)).run();
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
