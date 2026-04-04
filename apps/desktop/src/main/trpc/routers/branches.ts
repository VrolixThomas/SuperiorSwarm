import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import { projects } from "../../db/schema";
import { listBranches, sortBranchesWithDefault } from "../../git/operations";
import { publicProcedure, router } from "../index";

export const branchesRouter = router({
	list: publicProcedure.input(z.object({ projectId: z.string() })).query(async ({ input }) => {
		const db = getDb();
		const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

		if (!project) {
			throw new Error("Project not found");
		}

		const branches = await listBranches(project.repoPath);
		return sortBranchesWithDefault(branches, project.defaultBranch);
	}),
});
