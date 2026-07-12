import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { projects, workspaces, worktrees } from "../db/schema";
import { resolveWorkspaceCwd } from "../services/workspace-cwd";

export function getWorkspaceCwdOrThrow(workspaceId: string): string {
	const db = getDb();
	const ws = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
	if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);
	const wt = ws.worktreeId
		? db.select().from(worktrees).where(eq(worktrees.id, ws.worktreeId)).get()
		: null;
	const project = db.select().from(projects).where(eq(projects.id, ws.projectId)).get();
	if (!project) throw new Error(`Project not found: ${ws.projectId}`);
	return resolveWorkspaceCwd({
		worktreePath: wt?.path ?? null,
		folderPath: ws.folderPath,
		repoPath: project.repoPath,
	});
}
