import type { PRContext } from "../../../../shared/github-types";
import type { ReviewSnapshotContent } from "../../../../shared/review-snapshot-types";
import { trpc } from "../../../trpc/client";

const fullOid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const SNAPSHOT_REFRESH =
	"Revision content is unavailable. Refresh the PR after acquiring its exact commits locally.";

export function isSnapshotBusy(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const value = error as { data?: { code?: string }; message?: string };
	return (
		value.data?.code === "TOO_MANY_REQUESTS" ||
		value.message === "Review snapshot reader is busy. Retry shortly"
	);
}
export const snapshotQueryOptions = {
	staleTime: 30_000,
	retry: (count: number, error: unknown) => count < 3 && isSnapshotBusy(error),
	retryDelay: (attempt: number) => Math.min(1000, 250 * 2 ** attempt),
	refetchOnWindowFocus: false,
	trpc: { abortOnUnmount: true },
};
export function snapshotErrorMessage(...errors: unknown[]): string {
	return errors.some(isSnapshotBusy)
		? "Revision reader is busy. Try refreshing again shortly."
		: SNAPSHOT_REFRESH;
}

/** A missing revision stays missing; never substitute source/target branches. */
export function useReviewSnapshot(
	workspaceId: string | undefined,
	prCtx: PRContext,
	baseRef?: string,
	headRef?: string
) {
	const enabled = !!workspaceId && fullOid.test(baseRef ?? "") && fullOid.test(headRef ?? "");
	const query = trpc.reviewExplanation.resolveSnapshot.useQuery(
		{
			workspaceId: workspaceId ?? "",
			targetTipOid: baseRef ?? "",
			headOid: headRef ?? "",
			review: {
				provider: prCtx.provider,
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			},
		},
		{ ...snapshotQueryOptions, enabled }
	);
	return {
		...query,
		available: enabled,
		snapshot: enabled && !query.isError ? query.data : undefined,
	};
}

export function snapshotContentMessage(value: ReviewSnapshotContent | undefined): string | null {
	if (!value) return SNAPSHOT_REFRESH;
	if (value.kind === "absent") return "File does not exist at this revision.";
	if (value.kind === "unavailable") return SNAPSHOT_REFRESH;
	if (value.kind === "text") return value.content === "" ? "File is empty at this revision." : null;
	const reasons = {
		binary: "Binary file — no text preview available.",
		symlink: "Symbolic link — content is not followed.",
		submodule: "Submodule — no text preview available.",
		"too-large": "File exceeds the snapshot text preview limit.",
		"non-utf8": "File is not UTF-8 text — no preview available.",
		"lfs-pointer": "Git LFS content is omitted from this snapshot.",
		"unsupported-mode": "This file type is omitted from the snapshot.",
	};
	return reasons[value.reason];
}
