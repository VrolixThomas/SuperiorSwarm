import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { CreateWorkspaceRequest, CreateWorkspaceResponse } from "../../shared/control-plane";
import { getDb } from "../db";
import { projects, sharedFiles, workspaces, worktrees } from "../db/schema";
import { createWorktree } from "../git/operations";
import { symlinkSharedFiles } from "../shared-files";

function worktreeBasePath(repoPath: string): string {
	const parent = dirname(repoPath);
	const name = repoPath.split("/").pop() ?? "repo";
	return join(parent, `${name}-worktrees`);
}

export async function createWorkspace(
	input: CreateWorkspaceRequest
): Promise<CreateWorkspaceResponse> {
	const db = getDb();
	const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
	if (!project) {
		throw new Error(`Project not found: ${input.projectId}`);
	}

	const baseBranch = input.baseBranch ?? project.defaultBranch;
	const path = join(worktreeBasePath(project.repoPath), input.branch);

	await createWorktree(project.repoPath, path, input.branch, baseBranch);

	const now = new Date();
	const worktreeId = nanoid();
	const workspaceId = nanoid();

	db.insert(worktrees)
		.values({
			id: worktreeId,
			projectId: input.projectId,
			path,
			branch: input.branch,
			baseBranch,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	db.insert(workspaces)
		.values({
			id: workspaceId,
			projectId: input.projectId,
			type: "worktree",
			name: input.branch,
			worktreeId,
			terminalId: null,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	const sharedEntries = db
		.select()
		.from(sharedFiles)
		.where(eq(sharedFiles.projectId, input.projectId))
		.all();

	if (sharedEntries.length > 0) {
		await symlinkSharedFiles(
			project.repoPath,
			path,
			sharedEntries.map((e) => ({ relativePath: e.relativePath, type: e.type }))
		);
	}

	return {
		workspaceId,
		worktreeId,
		path,
		branch: input.branch,
		baseBranch,
	};
}
