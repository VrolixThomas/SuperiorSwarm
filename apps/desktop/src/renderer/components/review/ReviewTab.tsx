import { useEffect, useMemo } from "react";
import { detectLanguage } from "../../../shared/diff-types";
import type { ScopedDiffFile } from "../../../shared/review-types";
import { useReviewSessionStore } from "../../stores/review-session-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { DiffEditor } from "../DiffEditor";
import { ReviewProgressBar } from "./ReviewProgressBar";

export function ReviewTab({
	workspaceId,
	repoPath,
	baseBranch,
}: {
	workspaceId: string;
	repoPath: string;
	baseBranch: string;
}) {
	const session = useReviewSessionStore((s) => s.activeSession);

	// Resolve current branch live via status query
	const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
		{ repoPath },
		{ refetchInterval: 5_000 },
	);
	const currentBranch = statusQuery.data?.branch ?? "";

	// Working + branch diffs
	const workingQuery = trpc.diff.getWorkingTreeDiff.useQuery(
		{ repoPath },
		{ refetchInterval: 2_000 },
	);
	const branchQuery = trpc.diff.getBranchDiff.useQuery(
		{ repoPath, baseBranch, headBranch: currentBranch },
		{ refetchInterval: 2_000, enabled: !!currentBranch },
	);

	const allFiles: ScopedDiffFile[] = useMemo(() => {
		const w = (workingQuery.data?.files ?? []).map((f): ScopedDiffFile => ({ ...f, scope: "working" }));
		const b = (branchQuery.data?.files ?? []).map((f): ScopedDiffFile => ({ ...f, scope: "branch" }));
		return [...w, ...b];
	}, [workingQuery.data, branchQuery.data]);

	const scope = session?.scope ?? "all";
	const scopedFiles = useMemo(
		() => (scope === "all" ? allFiles : allFiles.filter((f) => f.scope === scope)),
		[allFiles, scope],
	);

	// Viewed state
	const viewedQuery = trpc.review.getViewed.useQuery({ workspaceId }, { refetchInterval: 10_000 });
	const viewedMap = useMemo(() => {
		const m = new Map<string, string>();
		for (const row of viewedQuery.data ?? []) m.set(row.filePath, row.contentHash);
		return m;
	}, [viewedQuery.data]);

	const reviewedInScope = useMemo(
		() => scopedFiles.filter((f) => viewedMap.has(f.path)).length,
		[scopedFiles, viewedMap],
	);

	const selectedFile: ScopedDiffFile | null = useMemo(
		() => scopedFiles.find((f) => f.path === session?.selectedFilePath) ?? null,
		[scopedFiles, session?.selectedFilePath],
	);

	useEffect(() => {
		useReviewSessionStore.getState().setFileSnapshot(allFiles, scopedFiles);
	}, [allFiles, scopedFiles]);

	// Auto-select first file if none selected or selection fell out of scope.
	// Loop-safety invariant: selectFile mutates selectedFilePath; the effect re-runs,
	// but the `first !== session.selectedFilePath` guard then short-circuits.
	// We key on session?.selectedFilePath (not the whole session) to narrow re-runs.
	const selectedFilePath = session?.selectedFilePath ?? null;
	useEffect(() => {
		if (!session) return;
		if (selectedFilePath && scopedFiles.some((f) => f.path === selectedFilePath)) return;
		const first = scopedFiles[0]?.path ?? null;
		if (first !== selectedFilePath) {
			useReviewSessionStore.getState().selectFile(first);
		}
	}, [session, selectedFilePath, scopedFiles]);

	// File content (original ref depends on scope)
	const originalRef = selectedFile?.scope === "branch" ? baseBranch : "HEAD";
	const contentQ = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: originalRef, filePath: selectedFile?.path ?? "" },
		{ enabled: !!selectedFile },
	);
	const modifiedQ = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: "", filePath: selectedFile?.path ?? "" },
		{ enabled: !!selectedFile },
	);

	const overlay = useReviewSessionStore((s) =>
		selectedFile ? s.activeSession?.editOverlay.get(selectedFile.path) : undefined,
	);
	const modifiedContent = overlay ?? modifiedQ.data?.content ?? "";

	const utils = trpc.useUtils();
	const setViewedMut = trpc.review.setViewed.useMutation({
		onSuccess: () => utils.review.getViewed.invalidate({ workspaceId }),
	});
	const unsetViewedMut = trpc.review.unsetViewed.useMutation({
		onSuccess: () => utils.review.getViewed.invalidate({ workspaceId }),
	});

	useEffect(() => {
		async function handleToggleViewed() {
			if (!selectedFile) return;
			const path = selectedFile.path;
			const modified = modifiedQ.data?.content ?? "";
			const { sha256Hex } = await import("../../lib/content-hash");
			const hash = await sha256Hex(modified);
			const stored = viewedMap.get(path);
			if (stored === hash) {
				unsetViewedMut.mutate({ workspaceId, filePath: path });
			} else {
				setViewedMut.mutate({ workspaceId, filePath: path, contentHash: hash });
			}
		}

		function handleOpenEdit() {
			if (!selectedFile) return;
			useTabStore.getState().openEditFileSplitForReview({
				workspaceId,
				repoPath,
				filePath: selectedFile.path,
			});
		}

		function handleCloseEdit() {
			useTabStore.getState().closeEditFileSplitForReview(workspaceId);
		}

		window.addEventListener("review:toggle-viewed", handleToggleViewed);
		window.addEventListener("review:open-edit", handleOpenEdit);
		window.addEventListener("review:close-edit", handleCloseEdit);
		return () => {
			window.removeEventListener("review:toggle-viewed", handleToggleViewed);
			window.removeEventListener("review:open-edit", handleOpenEdit);
			window.removeEventListener("review:close-edit", handleCloseEdit);
		};
	}, [selectedFile, modifiedQ.data, viewedMap, workspaceId, repoPath, setViewedMut, unsetViewedMut]);

	if (allFiles.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center text-[12px] text-[var(--text-quaternary)]">
				No working or branch changes
			</div>
		);
	}
	if (scopedFiles.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center text-[12px] text-[var(--text-quaternary)]">
				No {scope} changes
			</div>
		);
	}
	if (!selectedFile) {
		return (
			<div className="flex h-full flex-col items-center justify-center text-[12px] text-[var(--text-quaternary)]">
				No file selected
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col" data-review-tab>
			<ReviewProgressBar reviewed={reviewedInScope} total={scopedFiles.length} />
			<div className="flex-1 min-h-0">
				<DiffEditor
					original={contentQ.data?.content ?? ""}
					modified={modifiedContent}
					language={detectLanguage(selectedFile.path)}
					renderSideBySide={true}
					readOnly={true}
				/>
			</div>
		</div>
	);
}
