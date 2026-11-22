import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { ReviewSnapshotRevision } from "../../../shared/review-snapshot-types";
import { reviewRevisionAcquisition } from "../../review-explanation/acquisition-service";
import { ReviewSnapshotError, ReviewSnapshotService } from "../../review-explanation/snapshot";
import { getReviewSnapshotRoot } from "../../review-explanation/workspace-root";
import { publicProcedure, router } from "../index";

const oid = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
const id = z.string().regex(/^[0-9a-f]{64}$/);
const workspaceId = z.string().min(1).max(256);

async function snapshotCall<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		throw new TRPCError({
			code:
				error instanceof ReviewSnapshotError && error.code === "BUSY"
					? "TOO_MANY_REQUESTS"
					: "BAD_REQUEST",
			message:
				error instanceof ReviewSnapshotError ? error.message : "Review snapshot is unavailable",
		});
	}
}

export function createReviewExplanationRouter(
	service: ReviewSnapshotService,
	acquire: (input: ReviewSnapshotRevision) => Promise<void> = async () => {
		throw new Error("Review revision acquisition is unavailable");
	}
) {
	return router({
		acquireSnapshotRevisions: publicProcedure
			.input(
				z
					.object({
						workspaceId,
						targetTipOid: oid,
						headOid: oid,
						review: z
							.object({
								provider: z.enum(["github", "bitbucket"]),
								owner: z.string().min(1).max(256),
								repo: z.string().min(1).max(256),
								number: z.number().int().positive(),
							})
							.strict(),
					})
					.strict()
			)
			.mutation(async ({ input }) => {
				try {
					await acquire(input);
					return { acquired: true };
				} catch (error) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							error instanceof Error && error.message.startsWith("Review ")
								? error.message
								: "Review revision acquisition failed. Retry preparation.",
					});
				}
			}),
		resolveSnapshot: publicProcedure
			.input(
				z
					.object({
						workspaceId,
						targetTipOid: oid,
						headOid: oid,
						review: z
							.object({
								provider: z.enum(["github", "bitbucket"]),
								owner: z.string().min(1).max(256),
								repo: z.string().min(1).max(256),
								number: z.number().int().positive(),
							})
							.strict()
							.optional(),
					})
					.strict()
			)
			.query(({ input, signal }) => snapshotCall(() => service.create(input, signal))),
		getSnapshotFile: publicProcedure
			.input(
				z
					.object({ workspaceId, snapshotId: id, fileId: id, side: z.enum(["base", "head"]) })
					.strict()
			)
			.query(({ input, signal }) => snapshotCall(() => service.read(input, signal))),
		getSnapshotContext: publicProcedure
			.input(
				z
					.object({
						workspaceId,
						snapshotId: id,
						path: z.string().min(1).max(4096),
						side: z.enum(["base", "head"]),
					})
					.strict()
			)
			.query(({ input, signal }) => snapshotCall(() => service.readContext(input, signal))),
	});
}

export const reviewExplanationRouter = createReviewExplanationRouter(
	new ReviewSnapshotService({ resolveRoot: async (id) => getReviewSnapshotRoot(id) }),
	(input) => reviewRevisionAcquisition.acquire(input)
);
