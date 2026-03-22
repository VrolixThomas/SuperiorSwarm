import { z } from "zod";
import { getCachedPRs, refreshNow } from "../../ai-review/pr-poller";
import { publicProcedure, router } from "../index";

export const prPollerRouter = router({
	getCachedPRs: publicProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.query(({ input }) => getCachedPRs(input?.projectId)),

	refreshNow: publicProcedure.mutation(async () => {
		await refreshNow();
		return { success: true };
	}),
});
