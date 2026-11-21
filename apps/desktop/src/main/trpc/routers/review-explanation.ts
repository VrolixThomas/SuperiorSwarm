import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getWorkspaceCwdOrThrow } from "../../agent-launch/workspace-cwd-lookup";
import { ReviewSnapshotError, ReviewSnapshotService } from "../../review-explanation/snapshot";
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

export function createReviewExplanationRouter(service: ReviewSnapshotService) {
	return router({
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
	new ReviewSnapshotService({ resolveRoot: async (id) => getWorkspaceCwdOrThrow(id) })
);
