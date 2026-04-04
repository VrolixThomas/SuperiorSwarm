import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import { projects } from "../../db/schema";
import {
	abortMerge,
	getConflictContent,
	getConflictingFiles,
	markFileResolved,
	mergeBranch,
} from "../../git/merge-ops";
import { commitChanges } from "../../git/operations";
import { publicProcedure, router } from "../index";

async function resolvePath(projectId: string, cwd?: string): Promise<string> {
	if (cwd) return cwd;
	const db = getDb();
	const project = await db.query.projects.findFirst({
		where: eq(projects.id, projectId),
	});
	if (!project) throw new Error("Project not found");
	return project.repoPath;
}

export const mergeRouter = router({
	start: publicProcedure
		.input(z.object({ projectId: z.string(), branch: z.string(), cwd: z.string().optional() }))
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			return mergeBranch(path, input.branch);
		}),

	abort: publicProcedure
		.input(z.object({ projectId: z.string(), cwd: z.string().optional() }))
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			await abortMerge(path);
			return { success: true };
		}),

	getConflicts: publicProcedure
		.input(z.object({ projectId: z.string(), cwd: z.string().optional() }))
		.query(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			const files = await getConflictingFiles(path);
			return { files };
		}),

	getFileConflict: publicProcedure
		.input(z.object({ projectId: z.string(), filePath: z.string(), cwd: z.string().optional() }))
		.query(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			return getConflictContent(path, input.filePath);
		}),

	resolveFile: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				filePath: z.string(),
				content: z.string(),
				cwd: z.string().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			await markFileResolved(path, input.filePath, input.content);
			const remaining = await getConflictingFiles(path);
			const remainingConflicts = remaining.filter((f) => f.status === "conflicting").length;
			return { success: true, remainingConflicts };
		}),

	applyAndCommit: publicProcedure
		.input(z.object({ projectId: z.string(), message: z.string().min(1), cwd: z.string().optional() }))
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			await commitChanges(path, input.message);
			return { success: true };
		}),
});
