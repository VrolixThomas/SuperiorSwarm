import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import { projects, workspaces, worktrees } from "../../db/schema";
import {
	createWorktree,
	hasUncommittedChanges,
	removeWorktree,
} from "../../git/operations";
import { publicProcedure, router } from "../index";

function worktreeBasePath(repoPath: string): string {
	const parent = dirname(repoPath);
	const name = repoPath.split("/").pop() ?? "repo";
	return join(parent, `${name}-worktrees`);
}

export const workspacesRouter = router({
	listByProject: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.query(({ input }) => {
			const db = getDb();
			return db
				.select()
				.from(workspaces)
				.where(eq(workspaces.projectId, input.projectId))
				.all();
		}),

	create: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				branch: z.string().min(1),
				baseBranch: z.string().optional(),
			})
		)
		.mutation(async ({ input }) => {
			const db = getDb();
			const project = db
				.select()
				.from(projects)
				.where(eq(projects.id, input.projectId))
				.get();

			if (!project) {
				throw new Error("Project not found");
			}

			const baseBranch = input.baseBranch || project.defaultBranch;
			const worktreePath = join(worktreeBasePath(project.repoPath), input.branch);

			await createWorktree(project.repoPath, worktreePath, input.branch, baseBranch);

			const now = new Date();
			const worktreeId = nanoid();
			const workspaceId = nanoid();

			db.insert(worktrees)
				.values({
					id: worktreeId,
					projectId: input.projectId,
					path: worktreePath,
					branch: input.branch,
					baseBranch,
					createdAt: now,
					updatedAt: now,
				})
				.run();

			const workspace = {
				id: workspaceId,
				projectId: input.projectId,
				type: "worktree" as const,
				name: input.branch,
				worktreeId,
				terminalId: null as string | null,
				createdAt: now,
				updatedAt: now,
			};

			db.insert(workspaces).values(workspace).run();

			return workspace;
		}),

	delete: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ input }) => {
			const db = getDb();
			const workspace = db
				.select()
				.from(workspaces)
				.where(eq(workspaces.id, input.id))
				.get();

			if (!workspace) {
				throw new Error("Workspace not found");
			}

			if (workspace.type === "branch") {
				throw new Error("Cannot delete the main branch workspace");
			}

			if (!workspace.worktreeId) {
				throw new Error("Workspace has no associated worktree");
			}

			const worktree = db
				.select()
				.from(worktrees)
				.where(eq(worktrees.id, workspace.worktreeId))
				.get();

			if (!worktree) {
				throw new Error("Worktree not found");
			}

			const dirty = await hasUncommittedChanges(worktree.path);
			if (dirty) {
				throw new Error(
					"Worktree has uncommitted changes. Commit or discard them first."
				);
			}

			const project = db
				.select()
				.from(projects)
				.where(eq(projects.id, workspace.projectId))
				.get();

			if (!project) {
				throw new Error("Project not found");
			}

			await removeWorktree(project.repoPath, worktree.path);

			db.delete(worktrees).where(eq(worktrees.id, worktree.id)).run();
		}),

	attachTerminal: publicProcedure
		.input(z.object({ workspaceId: z.string(), terminalId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.update(workspaces)
				.set({ terminalId: input.terminalId, updatedAt: new Date() })
				.where(eq(workspaces.id, input.workspaceId))
				.run();
		}),

	detachTerminal: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.update(workspaces)
				.set({ terminalId: null, updatedAt: new Date() })
				.where(eq(workspaces.id, input.workspaceId))
				.run();
		}),
});
