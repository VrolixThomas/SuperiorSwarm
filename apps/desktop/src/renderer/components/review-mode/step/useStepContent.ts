import { useMemo } from "react";
import type { PRContext } from "../../../../shared/github-types";
import { trpc } from "../../../trpc/client";
export function useStepContent(prCtx: PRContext, currentFilePath: string | null) {
	const queryFilePath = currentFilePath ?? "";
	const branchDiffQuery = trpc.diff.getBranchDiff.useQuery(
		{
			repoPath: prCtx.repoPath,
			baseBranch: prCtx.targetBranch,
			headBranch: prCtx.sourceBranch,
		},
		{ staleTime: 60_000 }
	);
	const originalQuery = trpc.diff.getFileContent.useQuery(
		{
			repoPath: prCtx.repoPath,
			ref: branchDiffQuery.data?.mergeBase ?? "",
			filePath:
				branchDiffQuery.data?.files.find((file) => file.path === currentFilePath)?.oldPath ??
				queryFilePath,
		},
		{
			enabled: currentFilePath !== null && branchDiffQuery.data?.mergeBase != null,
			staleTime: 60_000,
		}
	);
	const modifiedQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath: prCtx.repoPath, ref: prCtx.sourceBranch, filePath: queryFilePath },
		{ enabled: currentFilePath !== null, staleTime: 60_000 }
	);
	const unavailable = branchDiffQuery.isError || originalQuery.isError || modifiedQuery.isError;
	const isLoading =
		currentFilePath !== null &&
		!unavailable &&
		(branchDiffQuery.data?.mergeBase == null || originalQuery.isPending || modifiedQuery.isPending);
	const originalContent = isLoading || unavailable ? "" : (originalQuery.data?.content ?? "");
	const modifiedContent = isLoading || unavailable ? "" : (modifiedQuery.data?.content ?? "");
	const binary =
		branchDiffQuery.data?.files.find((file) => file.path === currentFilePath)?.status ===
			"binary" ||
		originalContent.includes("\0") ||
		modifiedContent.includes("\0");
	const validDiffLines = useMemo(() => {
		const fileData = branchDiffQuery.data?.files.find((file) => file.path === currentFilePath);
		if (!fileData) return undefined;
		const lines = new Set<number>();
		for (const hunk of fileData.hunks) {
			for (const diffLine of hunk.lines) {
				if (diffLine.newLineNumber != null) lines.add(diffLine.newLineNumber);
			}
		}
		return lines;
	}, [branchDiffQuery.data, currentFilePath]);

	const validOriginalDiffLines = useMemo(() => {
		const file = branchDiffQuery.data?.files.find((file) => file.path === currentFilePath);
		if (!file) return undefined;
		return new Set(
			file.hunks.flatMap((hunk) =>
				hunk.lines.flatMap((line) => (line.oldLineNumber == null ? [] : [line.oldLineNumber]))
			)
		);
	}, [branchDiffQuery.data, currentFilePath]);

	return {
		originalContent,
		modifiedContent,
		isLoading,
		unavailable,
		binary,
		validDiffLines,
		validOriginalDiffLines,
	};
}
