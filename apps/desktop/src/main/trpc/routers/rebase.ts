import { z } from "zod";
import {
	abortRebase,
	continueRebase,
	getConflictingFiles,
	getRebaseProgress,
	rebaseBranch,
} from "../../git/merge-ops";
import { publicProcedure, router } from "../index";
import { resolvePath } from "./shared";

export const rebaseRouter = router({
	start: publicProcedure
		.input(z.object({ projectId: z.string(), ontoBranch: z.string(), cwd: z.string().optional() }))
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			return rebaseBranch(path, input.ontoBranch);
		}),

	abort: publicProcedure
		.input(z.object({ projectId: z.string(), cwd: z.string().optional() }))
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			await abortRebase(path);
			return { success: true };
		}),

	continue: publicProcedure
		.input(z.object({ projectId: z.string(), cwd: z.string().optional() }))
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			return continueRebase(path);
		}),

	getConflicts: publicProcedure
		.input(z.object({ projectId: z.string(), cwd: z.string().optional() }))
		.query(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			const files = await getConflictingFiles(path);
			const progress = await getRebaseProgress(path);
			return { files, progress };
		}),
});
