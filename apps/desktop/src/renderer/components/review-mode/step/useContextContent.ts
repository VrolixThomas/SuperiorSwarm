import type { PRContext } from "../../../../shared/github-types";
import { trpc } from "../../../trpc/client";
import { SNAPSHOT_REFRESH, snapshotContentMessage, useReviewSnapshot } from "./useReviewSnapshot";

export function useContextContent(
	workspaceId: string | undefined,
	prCtx: PRContext,
	path: string,
	baseRef?: string,
	headRef?: string
) {
	const revision = useReviewSnapshot(workspaceId, prCtx, baseRef, headRef);
	const query = trpc.reviewExplanation.getSnapshotContext.useQuery(
		{ workspaceId: workspaceId ?? "", snapshotId: revision.snapshot?.id ?? "", path, side: "head" },
		{ enabled: !!revision.snapshot, staleTime: 0, retry: false, refetchOnWindowFocus: false }
	);
	const message =
		!revision.available || revision.isError || query.isError
			? SNAPSHOT_REFRESH
			: revision.isPending || query.isPending
				? "Loading context file…"
				: snapshotContentMessage(query.data);
	return { content: !message && query.data?.kind === "text" ? query.data.content : "", message };
}
