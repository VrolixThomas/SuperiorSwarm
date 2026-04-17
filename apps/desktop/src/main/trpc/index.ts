import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

export const t = initTRPC.create({
	transformer: superjson,
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodIssues: error.cause instanceof ZodError ? error.cause.issues : null,
			},
		};
	},
});

export const router = t.router;
export const publicProcedure = t.procedure;
