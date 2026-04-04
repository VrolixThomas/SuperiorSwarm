import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import { projects } from "../../db/schema";
import { fetchAll, pull, push } from "../../git/remote-ops";
import { publicProcedure, router } from "../index";

async function getRepoPath(projectId: string): Promise<string> {
	const db = getDb();
	const project = await db.query.projects.findFirst({
		where: eq(projects.id, projectId),
	});
	if (!project) throw new Error("Project not found");
	return project.repoPath;
}

export const remoteRouter = router({
	push: publicProcedure
		.input(z.object({ projectId: z.string(), branch: z.string().optional() }))
		.mutation(async ({ input }) => {
			const repoPath = await getRepoPath(input.projectId);
			await push(repoPath, input.branch);
			return { success: true };
		}),

	pull: publicProcedure.input(z.object({ projectId: z.string() })).mutation(async ({ input }) => {
		const repoPath = await getRepoPath(input.projectId);
		return pull(repoPath);
	}),

	fetch: publicProcedure.input(z.object({ projectId: z.string() })).mutation(async ({ input }) => {
		const repoPath = await getRepoPath(input.projectId);
		await fetchAll(repoPath);
		return { success: true };
	}),
});
