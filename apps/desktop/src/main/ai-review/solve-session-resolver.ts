import { eq } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";

export interface ResolvedSession {
	session: schema.CommentSolveSession;
	workspace: schema.Workspace;
	worktree: schema.Worktree;
	worktreePath: string;
}

/**
 * Resolve a solve session's full chain: session → workspace → worktree.
 * Throws descriptive errors if any link is missing.
 */
export function resolveSessionWorktree(sessionId: string): ResolvedSession {
	const db = getDb();

	const session = db
		.select()
		.from(schema.commentSolveSessions)
		.where(eq(schema.commentSolveSessions.id, sessionId))
		.get();
	if (!session) throw new Error(`Solve session ${sessionId} not found`);

	const workspace = db
		.select()
		.from(schema.workspaces)
		.where(eq(schema.workspaces.id, session.workspaceId))
		.get();
	if (!workspace) throw new Error(`Workspace ${session.workspaceId} not found`);
	if (!workspace.worktreeId) throw new Error(`Workspace ${workspace.id} has no worktree`);

	const worktree = db
		.select()
		.from(schema.worktrees)
		.where(eq(schema.worktrees.id, workspace.worktreeId))
		.get();
	if (!worktree) throw new Error(`Worktree ${workspace.worktreeId} not found`);

	return { session, workspace, worktree, worktreePath: worktree.path };
}
