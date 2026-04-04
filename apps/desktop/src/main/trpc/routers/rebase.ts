import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import { projects } from "../../db/schema";
import {
	abortRebase,
	continueRebase,
	getConflictingFiles,
	getRebaseProgress,
	rebaseBranch,
} from "../../git/merge-ops";
import { publicProcedure, router } from "../index";

async function getRepoPath(projectId: string): Promise<string> {
	const db = getDb();
	const project = await db.query.projects.findFirst({
		where: eq(projects.id, projectId),
	});
	if (!project) throw new Error("Project not found");
	return project.repoPath;
}

export const rebaseRouter = router({
	start: publicProcedure
		.input(z.object({ projectId: z.string(), ontoBranch: z.string() }))
		.mutation(async ({ input }) => {
			const repoPath = await getRepoPath(input.projectId);
			return rebaseBranch(repoPath, input.ontoBranch);
		}),

	abort: publicProcedure.input(z.object({ projectId: z.string() })).mutation(async ({ input }) => {
		const repoPath = await getRepoPath(input.projectId);
		await abortRebase(repoPath);
		return { success: true };
	}),

	continue: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.mutation(async ({ input }) => {
			const repoPath = await getRepoPath(input.projectId);
			return continueRebase(repoPath);
		}),

	getConflicts: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ input }) => {
			const repoPath = await getRepoPath(input.projectId);
			const files = await getConflictingFiles(repoPath);
			const progress = getRebaseProgress(repoPath);
			return { files, progress };
		}),
});
