import { structuredPatch } from "diff";
import { useMemo } from "react";
import type { GitHubPRDetails, PRContext } from "../../../../shared/github-types";
import { trpc } from "../../../trpc/client";
import {
	snapshotContentMessage,
	snapshotErrorMessage,
	snapshotQueryOptions,
	useReviewSnapshot,
} from "./useReviewSnapshot";

export function useStepContent(
	workspaceId: string,
	prCtx: PRContext,
	details: GitHubPRDetails,
	currentFilePath: string | null
) {
	const revision = useReviewSnapshot(
		workspaceId,
		prCtx,
		details.baseCommitOid,
		details.headCommitOid
	);
	const file = revision.snapshot?.files.find((file) => file.path === currentFilePath);
	const input = { workspaceId, snapshotId: revision.snapshot?.id ?? "", fileId: file?.id ?? "" };
	const options = { ...snapshotQueryOptions, enabled: !!file };
	const originalQuery = trpc.reviewExplanation.getSnapshotFile.useQuery(
		{ ...input, side: "base" },
		options
	);
	const modifiedQuery = trpc.reviewExplanation.getSnapshotFile.useQuery(
		{ ...input, side: "head" },
		options
	);
	const failed =
		!revision.available || revision.isError || originalQuery.isError || modifiedQuery.isError;
	const isLoading =
		currentFilePath !== null &&
		!failed &&
		(revision.isPending || (!!file && (originalQuery.isPending || modifiedQuery.isPending)));
	const original = originalQuery.data;
	const modified = modifiedQuery.data;
	const binary = [original, modified].some(
		(value) => value?.kind === "omitted" && value.reason === "binary"
	);
	const unavailable =
		failed ||
		(!isLoading &&
			currentFilePath !== null &&
			(!file ||
				[original, modified].some(
					(value) => !value || value.kind === "unavailable" || value.kind === "omitted"
				)));
	const originalContent =
		!isLoading && !unavailable && original?.kind === "text" ? original.content : "";
	const modifiedContent =
		!isLoading && !unavailable && modified?.kind === "text" ? modified.content : "";
	const contentMessage = failed
		? snapshotErrorMessage(revision.error, originalQuery.error, modifiedQuery.error)
		: !isLoading && !file && currentFilePath !== null
			? "File is not part of this snapshot. Refresh the PR to update its file list."
			: !isLoading
				? ([original, modified]
						.filter((value) => value?.kind !== "absent" && value?.kind !== "text")
						.map(snapshotContentMessage)[0] ?? null)
				: null;
	const { validDiffLines, validOriginalDiffLines } = useMemo(() => {
		const right = new Set<number>();
		const left = new Set<number>();
		if (!isLoading && !unavailable && file) {
			// Bound expensive comparisons; unknown comment anchors remain disallowed.
			const patch = structuredPatch(
				"base",
				"head",
				originalContent,
				modifiedContent,
				undefined,
				undefined,
				{ context: 3, timeout: 100 }
			);
			for (const hunk of patch?.hunks ?? []) {
				let oldLine = hunk.oldStart;
				let newLine = hunk.newStart;
				for (const line of hunk.lines) {
					if (line[0] === " " || line[0] === "-") left.add(oldLine++);
					if (line[0] === " " || line[0] === "+") right.add(newLine++);
				}
			}
		}
		return { validDiffLines: right, validOriginalDiffLines: left };
	}, [isLoading, unavailable, file, originalContent, modifiedContent]);
	return {
		commitSha: revision.snapshot?.headOid,
		originalContent,
		modifiedContent,
		isLoading,
		unavailable,
		binary,
		contentMessage,
		originalState: original,
		modifiedState: modified,
		validDiffLines,
		validOriginalDiffLines,
	};
}
