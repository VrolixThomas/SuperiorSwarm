import { z } from "zod";
import { getDb } from "../../db";
import { getViewed, setViewed, unsetViewed } from "../../review/viewed-ops";
import { publicProcedure, router } from "../index";

export const reviewRouter = router({
	getViewed: publicProcedure.input(z.object({ workspaceId: z.string() })).query(({ input }) => {
		const db = getDb();
		return getViewed(db, input.workspaceId);
	}),

	setViewed: publicProcedure
		.input(
			z.object({
				workspaceId: z.string(),
				filePath: z.string(),
				contentHash: z.string(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			setViewed(db, input);
			return { ok: true };
		}),

	unsetViewed: publicProcedure
		.input(z.object({ workspaceId: z.string(), filePath: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			unsetViewed(db, input);
			return { ok: true };
		}),
});
