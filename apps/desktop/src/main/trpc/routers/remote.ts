import { z } from "zod";
import { fetchAll, pull, push } from "../../git/remote-ops";
import { publicProcedure, router } from "../index";
import { resolvePath } from "./shared";

export const remoteRouter = router({
	push: publicProcedure
		.input(
			z.object({ projectId: z.string(), branch: z.string().optional(), cwd: z.string().optional() })
		)
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			await push(path, input.branch);
			return { success: true };
		}),

	pull: publicProcedure
		.input(z.object({ projectId: z.string(), cwd: z.string().optional() }))
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			return pull(path);
		}),

	fetch: publicProcedure
		.input(z.object({ projectId: z.string(), cwd: z.string().optional() }))
		.mutation(async ({ input }) => {
			const path = await resolvePath(input.projectId, input.cwd);
			await fetchAll(path);
			return { success: true };
		}),
});
