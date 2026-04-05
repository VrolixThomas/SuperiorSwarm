import { z } from "zod";
import { getSession, signIn, signOut } from "../../supabase/auth";
import { publicProcedure } from "../index";
import { router } from "../index";

export const authRouter = router({
	getSession: publicProcedure.query(async () => {
		return getSession();
	}),

	signIn: publicProcedure
		.input(z.object({ provider: z.enum(["github", "google", "apple"]) }))
		.mutation(async ({ input }) => {
			return signIn(input.provider);
		}),

	signOut: publicProcedure.mutation(async () => {
		await signOut();
		return { success: true };
	}),
});
