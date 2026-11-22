import { z } from "zod";
import {
	queuePROriginSchema,
	queuePRPublicationSchema,
} from "../../../shared/queue-pr-publication";
import {
	cancelQueuePRReview,
	dispatchQueuePRReview,
	prepareQueuePRReview,
	queuePRReviewCapability,
	queuePRReviewReceipt,
} from "../../activity-queue/pr-actions";
import {
	cancelQueuePRPublication,
	dispatchQueuePRPublication,
	prepareQueuePRPublication,
} from "../../activity-queue/pr-publication";
import { solveQueuePRFeedback } from "../../activity-queue/pr-solve";
import { queueSolveOrigin } from "../../activity-queue/solve-queue-origin";
import { publicProcedure } from "../index";
const revision = z.object({ id: z.string().min(1), revision: z.number().int().positive() });
const request = z.object({ requestId: z.string().uuid() });
export const queuePRProcedures = {
	prSolvePublicationContext: publicProcedure
		.input(z.object({ sessionId: z.string() }))
		.query(({ input }) => queueSolveOrigin(input.sessionId)),
	prPublicationPrepare: publicProcedure
		.input(
			z.object({
				origin: queuePROriginSchema,
				requestId: z.string().uuid(),
				headSha: z.string().min(1).max(128),
				operation: queuePRPublicationSchema,
			})
		)
		.mutation(({ input }) => prepareQueuePRPublication(input)),
	prPublicationCancel: publicProcedure
		.input(request)
		.mutation(({ input }) => cancelQueuePRPublication(input.requestId)),
	prPublicationDispatch: publicProcedure
		.input(request)
		.mutation(({ input }) => dispatchQueuePRPublication(input.requestId)),
	prSolveFeedback: publicProcedure
		.input(revision)
		.mutation(({ input }) => solveQueuePRFeedback(input)),
	prReviewCapability: publicProcedure
		.input(revision)
		.query(({ input }) => queuePRReviewCapability(input)),
	prReviewPrepare: publicProcedure
		.input(
			revision.extend({
				requestId: z.string().uuid(),
				headSha: z.string().min(1).max(128),
				approveAnyway: z.boolean(),
			})
		)
		.mutation(({ input }) => prepareQueuePRReview(input)),
	prReviewCancel: publicProcedure
		.input(request)
		.mutation(({ input }) => cancelQueuePRReview(input.requestId)),
	prReviewDispatch: publicProcedure
		.input(request)
		.mutation(({ input }) => dispatchQueuePRReview(input.requestId)),
	prReviewReceipt: publicProcedure
		.input(request)
		.query(({ input }) => queuePRReviewReceipt(input.requestId)),
};
