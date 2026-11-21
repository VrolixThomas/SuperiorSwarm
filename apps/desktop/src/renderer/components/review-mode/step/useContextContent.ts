import type { PRContext } from "../../../../shared/github-types";
import { trpc } from "../../../trpc/client";
import {
	snapshotContentMessage,
	snapshotErrorMessage,
	snapshotQueryOptions,
	useReviewSnapshot,
} from "./useReviewSnapshot";

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
		{ ...snapshotQueryOptions, enabled: !!revision.snapshot }
	);
	const message =
		!revision.available || revision.isError || query.isError
			? snapshotErrorMessage(revision.error, query.error)
			: revision.isPending || query.isPending
				? "Loading context file…"
				: snapshotContentMessage(query.data);
	return { content: !message && query.data?.kind === "text" ? query.data.content : "", message };
}
