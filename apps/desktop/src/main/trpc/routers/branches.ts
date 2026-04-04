import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import { projects } from "../../db/schema";
import {
	checkoutBranch,
	createBranch,
	deleteBranch,
	getBranchInfo,
	getBranchStatus,
	listBranchesDetailed,
	renameBranch,
} from "../../git/branch-ops";
import { publicProcedure, router } from "../index";

export const branchesRouter = router({
	list: publicProcedure.input(z.object({ projectId: z.string() })).query(async ({ input }) => {
		const db = getDb();
		const project = await db.query.projects.findFirst({
			where: eq(projects.id, input.projectId),
		});
		if (!project) throw new Error("Project not found");
		return listBranchesDetailed(project.repoPath, project.defaultBranch);
	}),

	checkout: publicProcedure
		.input(z.object({ projectId: z.string(), branch: z.string(), cwd: z.string().optional() }))
		.mutation(async ({ input }) => {
			const db = getDb();
			const project = await db.query.projects.findFirst({
				where: eq(projects.id, input.projectId),
			});
			if (!project) throw new Error("Project not found");
			// Use the workspace CWD if provided (for worktree contexts), otherwise the main repo
			await checkoutBranch(input.cwd ?? project.repoPath, input.branch);
			return { success: true };
		}),

	create: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				name: z.string().min(1),
				baseBranch: z.string(),
			})
		)
		.mutation(async ({ input }) => {
			const db = getDb();
			const project = await db.query.projects.findFirst({
				where: eq(projects.id, input.projectId),
			});
			if (!project) throw new Error("Project not found");
			await createBranch(project.repoPath, input.name, input.baseBranch);
			return { success: true, branch: input.name };
		}),

	delete: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				branch: z.string(),
				force: z.boolean().optional().default(false),
			})
		)
		.mutation(async ({ input }) => {
			const db = getDb();
			const project = await db.query.projects.findFirst({
				where: eq(projects.id, input.projectId),
			});
			if (!project) throw new Error("Project not found");
			await deleteBranch(project.repoPath, input.branch, input.force);
			return { success: true };
		}),

	rename: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				oldName: z.string(),
				newName: z.string().min(1),
			})
		)
		.mutation(async ({ input }) => {
			const db = getDb();
			const project = await db.query.projects.findFirst({
				where: eq(projects.id, input.projectId),
			});
			if (!project) throw new Error("Project not found");
			await renameBranch(project.repoPath, input.oldName, input.newName);
			return { success: true };
		}),

	getStatus: publicProcedure
		.input(z.object({ projectId: z.string(), cwd: z.string().optional() }))
		.query(async ({ input }) => {
			const db = getDb();
			const project = await db.query.projects.findFirst({
				where: eq(projects.id, input.projectId),
			});
			if (!project) throw new Error("Project not found");
			return getBranchStatus(input.cwd ?? project.repoPath);
		}),

	getInfo: publicProcedure
		.input(z.object({ projectId: z.string(), branch: z.string() }))
		.query(async ({ input }) => {
			const db = getDb();
			const project = await db.query.projects.findFirst({
				where: eq(projects.id, input.projectId),
			});
			if (!project) throw new Error("Project not found");
			return getBranchInfo(project.repoPath, input.branch);
		}),
});
