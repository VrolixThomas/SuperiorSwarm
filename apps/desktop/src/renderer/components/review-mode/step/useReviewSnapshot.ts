import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PRContext } from "../../../../shared/github-types";
import type { ReviewSnapshotContent } from "../../../../shared/review-snapshot-types";
import {
	acquireSnapshotOnce,
	snapshotAcquisitionRefresh,
	subscribeSnapshotAcquisitionRefresh,
} from "../../../lib/snapshot-acquisition";
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
	if (errors.some(isSnapshotBusy)) return "Revision reader is busy. Try refreshing again shortly.";
	for (const error of errors) {
		if (
			error &&
			typeof error === "object" &&
			"message" in error &&
			typeof error.message === "string" &&
			error.message.startsWith("Review ")
		)
			return error.message;
	}
	return SNAPSHOT_REFRESH;
}

/** A missing revision stays missing; never substitute source/target branches. */
export function useReviewSnapshot(
	workspaceId: string | undefined,
	prCtx: PRContext,
	baseRef?: string,
	headRef?: string
) {
	const enabled = !!workspaceId && fullOid.test(baseRef ?? "") && fullOid.test(headRef ?? "");
	const input = {
		workspaceId: workspaceId ?? "",
		targetTipOid: baseRef ?? "",
		headOid: headRef ?? "",
		review: {
			provider: prCtx.provider,
			owner: prCtx.owner,
			repo: prCtx.repo,
			number: prCtx.number,
		},
	};
	const query = trpc.reviewExplanation.resolveSnapshot.useQuery(input, {
		...snapshotQueryOptions,
		enabled,
	});
	const mutation = trpc.reviewExplanation.acquireSnapshotRevisions.useMutation();
	const refresh = useSyncExternalStore(
		subscribeSnapshotAcquisitionRefresh,
		snapshotAcquisitionRefresh,
		snapshotAcquisitionRefresh
	);
	const key = JSON.stringify(input);
	const attempted = useRef("");
	const [acquisition, setAcquisition] = useState<{
		key: string;
		pending: boolean;
		error?: unknown;
	}>();
	const missing =
		enabled &&
		query.isError &&
		query.error.message ===
			"Review commit objects are unavailable locally. Acquire the revision before retrying";
	const { mutateAsync } = mutation;
	const { refetch } = query;
	useEffect(() => {
		const attemptKey = `${refresh}:${key}`;
		if (!missing || attempted.current === attemptKey) return;
		let active = true;
		setAcquisition({ key, pending: true });
		const captured = JSON.parse(key) as typeof input;
		void acquireSnapshotOnce(captured, () => mutateAsync(captured)).then(
			async () => {
				if (!active) return;
				attempted.current = attemptKey;
				setAcquisition({ key, pending: false });
				await refetch();
			},
			(error: unknown) => {
				if (active) {
					attempted.current = attemptKey;
					setAcquisition({ key, pending: false, error });
				}
			}
		);
		return () => {
			active = false;
		};
	}, [key, missing, mutateAsync, refetch, refresh]);
	const currentAcquisition = acquisition?.key === key ? acquisition : undefined;
	return {
		...query,
		isPending: query.isPending || (query.isError && !!currentAcquisition?.pending),
		isError: query.isError && !currentAcquisition?.pending,
		error: currentAcquisition?.error ?? query.error,
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
