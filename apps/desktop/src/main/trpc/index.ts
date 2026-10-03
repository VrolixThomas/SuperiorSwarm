import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import type { FileCaller } from "../terminal/terminal-files";

export interface TrpcContext {
	fileCaller?: FileCaller;
}

export const t = initTRPC.context<TrpcContext>().create({
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
