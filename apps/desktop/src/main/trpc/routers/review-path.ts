import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	reviewPathIdentitySchema,
	reviewPathRunScopeSchema,
	reviewPathSettingsSchema,
} from "../../../shared/review-path-runtime";
import type { ReviewPathApplication } from "../../review-path/application";
import { getReviewPathApplication } from "../../review-path/service";
import { contextStepSchema, questionInputSchema } from "../../review-path/validation";
import { publicProcedure, router } from "../index";

async function call<T>(fn: () => T | Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: e instanceof Error ? e.message : "Reading path unavailable",
		});
	}
}
export function createReviewPathRouter(application: () => ReviewPathApplication) {
	return router({
		get: publicProcedure
			.input(z.object({ identity: reviewPathIdentitySchema }).strict())
			.query(({ input }) => call(() => application().get(input.identity))),
		start: publicProcedure
			.input(
				z
					.object({
						identity: reviewPathIdentitySchema,
						agent: z.object({ id: z.string().min(1), label: z.string().min(1) }).strict(),
						alsoReview: z.boolean(),
						auto: z.boolean().optional(),
					})
					.strict()
			)
			.mutation(({ input }) => call(() => application().start(input))),
		cancel: publicProcedure
			.input(reviewPathRunScopeSchema)
			.mutation(({ input }) => call(() => application().cancel(input))),
		ask: publicProcedure
			.input(questionInputSchema.extend({ identity: reviewPathIdentitySchema }))
			.mutation(({ input: { identity, ...question } }) =>
				call(() => application().ask(identity, question))
			),
		cancelQuestion: publicProcedure
			.input(reviewPathRunScopeSchema)
			.mutation(({ input }) => call(() => application().cancel(input))),
		addContext: publicProcedure
			.input(
				z
					.object({
						identity: reviewPathIdentitySchema,
						entryId: z.string().min(1),
						step: contextStepSchema,
					})
					.strict()
			)
			.mutation(({ input }) =>
				call(() => {
					const app = application();
					app.deps.validateWorkspace(input.identity);
					app.deps.storage.addUserContext(input.identity, input.entryId, input.step);
					return app.get(input.identity);
				})
			),
		removeContext: publicProcedure
			.input(z.object({ identity: reviewPathIdentitySchema, stepId: z.string().min(1) }).strict())
			.mutation(({ input }) =>
				call(() => {
					const app = application();
					app.deps.validateWorkspace(input.identity);
					app.deps.storage.removeUserContext(input.identity, input.stepId);
					return app.get(input.identity);
				})
			),
		getSettings: publicProcedure.query(() => call(() => application().deps.storage.getSettings())),
		updateSettings: publicProcedure
			.input(reviewPathSettingsSchema)
			.mutation(({ input }) => call(() => application().deps.storage.updateSettings(input))),
		importLegacySettings: publicProcedure
			.input(reviewPathSettingsSchema)
			.mutation(({ input }) => call(() => application().deps.storage.importLegacySettings(input))),
	});
}
export const reviewPathRouter = createReviewPathRouter(getReviewPathApplication);
