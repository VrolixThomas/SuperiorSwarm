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

async function getRepoPath(projectId: string): Promise<string> {
	const db = getDb();
	const project = await db.query.projects.findFirst({
		where: eq(projects.id, projectId),
	});
	if (!project) throw new Error("Project not found");
	return project.repoPath;
}

export const mergeRouter = router({
	start: publicProcedure
		.input(z.object({ projectId: z.string(), branch: z.string() }))
		.mutation(async ({ input }) => {
			const repoPath = await getRepoPath(input.projectId);
			return mergeBranch(repoPath, input.branch);
		}),

	abort: publicProcedure.input(z.object({ projectId: z.string() })).mutation(async ({ input }) => {
		const repoPath = await getRepoPath(input.projectId);
		await abortMerge(repoPath);
		return { success: true };
	}),

	getConflicts: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ input }) => {
			const repoPath = await getRepoPath(input.projectId);
			const files = await getConflictingFiles(repoPath);
			return { files };
		}),

	getFileConflict: publicProcedure
		.input(z.object({ projectId: z.string(), filePath: z.string() }))
		.query(async ({ input }) => {
			const repoPath = await getRepoPath(input.projectId);
			return getConflictContent(repoPath, input.filePath);
		}),

	resolveFile: publicProcedure
		.input(z.object({ projectId: z.string(), filePath: z.string(), content: z.string() }))
		.mutation(async ({ input }) => {
			const repoPath = await getRepoPath(input.projectId);
			await markFileResolved(repoPath, input.filePath, input.content);
			const remaining = await getConflictingFiles(repoPath);
			const remainingConflicts = remaining.filter((f) => f.status === "conflicting").length;
			return { success: true, remainingConflicts };
		}),

	applyAndCommit: publicProcedure
		.input(z.object({ projectId: z.string(), message: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const repoPath = await getRepoPath(input.projectId);
			await commitChanges(repoPath, input.message);
			return { success: true };
		}),
});
