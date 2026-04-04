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
import { resolvePath } from "./shared";

export const branchesRouter = router({
	list: publicProcedure
		.input(z.object({ projectId: z.string(), cwd: z.string().optional() }))
		.query(async ({ input }) => {
			const db = getDb();
			const project = await db.query.projects.findFirst({
				where: eq(projects.id, input.projectId),
			});
			if (!project) throw new Error("Project not found");
			return listBranchesDetailed(project.repoPath, project.defaultBranch, input.cwd);
		}),

	checkout: publicProcedure
		.input(z.object({ projectId: z.string(), branch: z.string(), cwd: z.string().optional() }))
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			await checkoutBranch(path, input.branch);
			return { success: true };
		}),

	create: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				name: z.string().min(1),
				baseBranch: z.string(),
				cwd: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			await createBranch(path, input.name, input.baseBranch);
			return { success: true, branch: input.name };
		}),

	delete: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				branch: z.string(),
				force: z.boolean().optional().default(false),
				cwd: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			await deleteBranch(path, input.branch, input.force);
			return { success: true };
		}),

	rename: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				oldName: z.string(),
				newName: z.string().min(1),
				cwd: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			await renameBranch(path, input.oldName, input.newName);
			return { success: true };
		}),

	getStatus: publicProcedure
		.input(z.object({ projectId: z.string(), cwd: z.string().optional() }))
		.query(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			return getBranchStatus(path);
		}),

	getInfo: publicProcedure
		.input(z.object({ projectId: z.string(), branch: z.string(), cwd: z.string().optional() }))
		.query(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			return getBranchInfo(path, input.branch);
		}),
});
