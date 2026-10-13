import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { eq } from "drizzle-orm";
import { WorkspaceError } from "../../shared/workspace-errors";
import { getDb } from "../db";
import { crossRepoOrchestrators, projects, workspaces, worktrees } from "../db/schema";
import { resolveWorkspaceCwd } from "../services/workspace-cwd";

export function canonicalWorkspaceDirectory(path: string): string {
	if (!path || !isAbsolute(path) || path.includes("\0") || Buffer.from(path).toString() !== path)
		throw new WorkspaceError("WORKSPACE_PATH_INVALID");
	try {
		const root = realpathSync(path);
		if (!statSync(root).isDirectory()) throw new WorkspaceError("WORKSPACE_NOT_DIRECTORY");
		return root;
	} catch (error) {
		console.error("[workspace-cwd] Cannot resolve directory:", { path, error });
		if (error instanceof WorkspaceError) throw error;
		const code = (error as NodeJS.ErrnoException).code;
		throw new WorkspaceError(
			code === "ENOENT"
				? "WORKSPACE_FOLDER_MISSING"
				: code === "ENOTDIR"
					? "WORKSPACE_NOT_DIRECTORY"
					: "WORKSPACE_FOLDER_UNAVAILABLE"
		);
	}
}

export function getWorkspaceCwdOrThrow(workspaceId: string): string {
	const db = getDb();
	const ws = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
	if (!ws) {
		const coordinator = db
			.select()
			.from(crossRepoOrchestrators)
			.where(eq(crossRepoOrchestrators.id, workspaceId))
			.get();
		if (!coordinator) throw new WorkspaceError("WORKSPACE_NOT_FOUND");
		if (coordinator.kind !== "workspace") throw new WorkspaceError("WORKSPACE_KIND_UNSUPPORTED");
		return canonicalWorkspaceDirectory(coordinator.workDir);
	}
	const wt = ws.worktreeId
		? db.select().from(worktrees).where(eq(worktrees.id, ws.worktreeId)).get()
		: null;
	if (ws.worktreeId && !wt) throw new WorkspaceError("WORKSPACE_WORKTREE_MISSING");
	const project = db.select().from(projects).where(eq(projects.id, ws.projectId)).get();
	if (!project) throw new WorkspaceError("WORKSPACE_PROJECT_MISSING");
	const cwd = resolveWorkspaceCwd({
		worktreePath: wt?.path ?? null,
		folderPath: ws.folderPath,
		repoPath: project.repoPath,
	});
	return canonicalWorkspaceDirectory(cwd);
}
