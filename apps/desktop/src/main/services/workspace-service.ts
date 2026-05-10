import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
	CreateWorkspaceRequest,
	CreateWorkspaceResponse,
	GetWorkspaceRequest,
	GetWorkspaceResponse,
	ListWorkspacesRequest,
	ListWorkspacesResponse,
	WorkspaceDto,
} from "../../shared/control-plane";
import { getDb } from "../db";
import { reviewDrafts } from "../db/schema-ai-review";
import { projects, sharedFiles, workspaces, worktrees } from "../db/schema";
import { createWorktree, hasUncommittedChanges } from "../git/operations";
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

type WorkspaceRow = {
	id: string;
	projectId: string;
	type: "branch" | "worktree" | "review";
	name: string;
	branch: string | null;
	worktreePath: string | null;
	baseBranch: string | null;
	prProvider: string | null;
	prIdentifier: string | null;
	draftStatus: string | null;
};

function rowToDto(row: WorkspaceRow): WorkspaceDto {
	return {
		id: row.id,
		projectId: row.projectId,
		type: row.type,
		name: row.name,
		branch: row.branch,
		worktreePath: row.worktreePath,
		baseBranch: row.baseBranch,
		prProvider: row.prProvider,
		prIdentifier: row.prIdentifier,
		draftStatus: row.draftStatus,
	};
}

const WORKSPACE_SELECT = {
	id: workspaces.id,
	projectId: workspaces.projectId,
	type: workspaces.type,
	name: workspaces.name,
	branch: worktrees.branch,
	worktreePath: worktrees.path,
	baseBranch: worktrees.baseBranch,
	prProvider: workspaces.prProvider,
	prIdentifier: workspaces.prIdentifier,
	draftStatus: reviewDrafts.status,
} as const;

export async function listWorkspaces(
	input: ListWorkspacesRequest
): Promise<ListWorkspacesResponse> {
	const db = getDb();
	const rows = db
		.select(WORKSPACE_SELECT)
		.from(workspaces)
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
		.where(eq(workspaces.projectId, input.projectId))
		.all();

	return { workspaces: rows.map(rowToDto) };
}

export async function getWorkspace(
	input: GetWorkspaceRequest
): Promise<GetWorkspaceResponse> {
	const db = getDb();
	const row = db
		.select(WORKSPACE_SELECT)
		.from(workspaces)
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
		.where(eq(workspaces.id, input.workspaceId))
		.get();

	if (!row) {
		throw new Error(`not_found: ${input.workspaceId}`);
	}
	if (row.projectId !== input.projectId) {
		throw new Error(`forbidden: workspace belongs to a different project`);
	}

	const dirty =
		row.worktreePath && existsSync(row.worktreePath)
			? await hasUncommittedChanges(row.worktreePath)
			: false;
	return { ...rowToDto(row), hasUncommittedChanges: dirty };
}
