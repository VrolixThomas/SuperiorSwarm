import { useEffect, useMemo } from "react";
import { detectLanguage } from "../../../shared/diff-types";
import type { ReviewScope, ScopedDiffFile } from "../../../shared/review-types";
import { useReviewSessionStore } from "../../stores/review-session-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { DiffEditor } from "../DiffEditor";
import { ReviewFilterTabs } from "./ReviewFilterTabs";
import { ReviewHintBar } from "./ReviewHintBar";
import { ReviewProgressBar } from "./ReviewProgressBar";

const BY_PATH = (a: ScopedDiffFile, b: ScopedDiffFile) => a.path.localeCompare(b.path);

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
	const diffMode = useTabStore((s) => s.diffMode);
	const setDiffMode = useTabStore((s) => s.setDiffMode);

	const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
		{ repoPath },
		{ refetchInterval: 5_000 },
	);
	const currentBranch = statusQuery.data?.branch ?? "";

	const workingQuery = trpc.diff.getWorkingTreeDiff.useQuery(
		{ repoPath },
		{ refetchInterval: 2_000 },
	);
	const branchQuery = trpc.diff.getBranchDiff.useQuery(
		{ repoPath, baseBranch, headBranch: currentBranch },
		{ refetchInterval: 2_000, enabled: !!currentBranch },
	);

	// Sort each scope alphabetically by path so j/k traversal matches sidebar display order.
	const allFiles: ScopedDiffFile[] = useMemo(() => {
		const w = (workingQuery.data?.files ?? [])
			.map((f): ScopedDiffFile => ({ ...f, scope: "working" }))
			.sort(BY_PATH);
		const b = (branchQuery.data?.files ?? [])
			.map((f): ScopedDiffFile => ({ ...f, scope: "branch" }))
			.sort(BY_PATH);
		return [...w, ...b];
	}, [workingQuery.data, branchQuery.data]);

	const scope = session?.scope ?? "all";
	const scopedFiles = useMemo(
		() => (scope === "all" ? allFiles : allFiles.filter((f) => f.scope === scope)),
		[allFiles, scope],
	);

	const workingCount = useMemo(() => allFiles.filter((f) => f.scope === "working").length, [allFiles]);
	const branchCount = useMemo(() => allFiles.filter((f) => f.scope === "branch").length, [allFiles]);

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

	// Auto-select invariant: see review-session-store for loop-safety.
	const selectedFilePath = session?.selectedFilePath ?? null;
	useEffect(() => {
		if (!session) return;
		if (selectedFilePath && scopedFiles.some((f) => f.path === selectedFilePath)) return;
		const first = scopedFiles[0]?.path ?? null;
		if (first !== selectedFilePath) {
			useReviewSessionStore.getState().selectFile(first);
		}
	}, [session, selectedFilePath, scopedFiles]);

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

		async function handleMarkViewed() {
			// Idempotent: used when advancing j/k to auto-mark the current file as viewed.
			if (!selectedFile) return;
			const path = selectedFile.path;
			const modified = modifiedQ.data?.content ?? "";
			const { sha256Hex } = await import("../../lib/content-hash");
			const hash = await sha256Hex(modified);
			if (viewedMap.get(path) === hash) return; // already viewed at this hash
			setViewedMut.mutate({ workspaceId, filePath: path, contentHash: hash });
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
		window.addEventListener("review:mark-viewed", handleMarkViewed);
		window.addEventListener("review:open-edit", handleOpenEdit);
		window.addEventListener("review:close-edit", handleCloseEdit);
		return () => {
			window.removeEventListener("review:toggle-viewed", handleToggleViewed);
			window.removeEventListener("review:mark-viewed", handleMarkViewed);
			window.removeEventListener("review:open-edit", handleOpenEdit);
			window.removeEventListener("review:close-edit", handleCloseEdit);
		};
	}, [selectedFile, modifiedQ.data, viewedMap, workspaceId, repoPath, setViewedMut, unsetViewedMut]);

	function handleScopeChange(next: ReviewScope) {
		const filtered =
			next === "all" ? allFiles : allFiles.filter((f) => f.scope === next);
		useReviewSessionStore.getState().setScope(next, filtered);
	}

	const header = (
		<div className="flex flex-col" data-review-tab>
			<ReviewFilterTabs
				scope={scope}
				allCount={allFiles.length}
				workingCount={workingCount}
				branchCount={branchCount}
				onScopeChange={handleScopeChange}
			/>
			<div className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-1">
				<ReviewProgressBar reviewed={reviewedInScope} total={scopedFiles.length} />
				<button
					type="button"
					onClick={() => setDiffMode(diffMode === "split" ? "inline" : "split")}
					className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]"
					title={`Switch to ${diffMode === "split" ? "unified" : "split"} view`}
				>
					{diffMode === "split" ? "Split" : "Unified"}
				</button>
			</div>
		</div>
	);

	if (allFiles.length === 0) {
		return (
			<div className="flex h-full flex-col" data-review-tab>
				{header}
				<div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-quaternary)]">
					No working or branch changes
				</div>
				<ReviewHintBar />
			</div>
		);
	}
	if (scopedFiles.length === 0) {
		return (
			<div className="flex h-full flex-col" data-review-tab>
				{header}
				<div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-quaternary)]">
					No {scope} changes
				</div>
				<ReviewHintBar />
			</div>
		);
	}
	if (!selectedFile) {
		return (
			<div className="flex h-full flex-col" data-review-tab>
				{header}
				<div className="flex flex-1 items-center justify-center text-[12px] text-[var(--text-quaternary)]">
					No file selected
				</div>
				<ReviewHintBar />
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col" data-review-tab>
			{header}
			<div className="min-h-0 flex-1">
				<DiffEditor
					original={contentQ.data?.content ?? ""}
					modified={modifiedContent}
					language={detectLanguage(selectedFile.path)}
					renderSideBySide={diffMode === "split"}
					readOnly={true}
				/>
			</div>
			<ReviewHintBar />
		</div>
	);
}
