import { z } from "zod";
export const queuePROriginSchema = z.object({
	id: z.string().min(1),
	revision: z.number().int().positive(),
});
export type QueuePROrigin = z.infer<typeof queuePROriginSchema>;
const review = {
	verdict: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
	body: z.string().max(60000),
};
export const queuePRPublicationSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("solve"),
		sessionId: z.string().min(1),
		groupId: z.string().min(1).optional(),
	}),
	z.object({ kind: z.literal("review"), ...review }),
	z.object({ kind: z.literal("draft"), draftId: z.string().min(1), ...review }),
	z.object({
		kind: z.literal("reply"),
		commentId: z.string().min(1),
		body: z.string().trim().min(1).max(60000),
	}),
	z.object({ kind: z.literal("resolve"), commentId: z.string().min(1) }),
]);
export type QueuePRPublication = z.infer<typeof queuePRPublicationSchema>;
