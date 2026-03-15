import { useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type { AIDraftThread, GitHubPRContext, GitHubPRDetails } from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { SubmitReviewModal } from "./SubmitReviewModal";

// ── StatusLine ───────────────────────────────────────────────────────────────

function StatusLine({ details }: { details: GitHubPRDetails }) {
	const reviewLabel = details.reviewDecision
		? details.reviewDecision.toLowerCase().replace("_", " ")
		: "no reviews";

	const ciLabel =
		details.ciState === "SUCCESS"
			? "CI \u2713"
			: details.ciState === "FAILURE"
				? "CI \u2717"
				: details.ciState === "PENDING"
					? "CI \u25CF"
					: null;

	const dotColor =
		details.reviewDecision === "APPROVED"
			? "bg-green-400"
			: details.reviewDecision === "CHANGES_REQUESTED"
				? "bg-red-400"
				: "bg-yellow-400";

	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
			<span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
			<span className="truncate text-[11px] text-[var(--text-tertiary)]">
				{reviewLabel}
				{ciLabel && (
					<>
						{" "}
						<span className="text-[var(--text-quaternary)]">&middot;</span> {ciLabel}
					</>
				)}
			</span>
		</div>
	);
}

// ── FileNavigator ────────────────────────────────────────────────────────────

function FileNavigator({
	details,
	prCtx,
	viewedFiles,
	onToggleViewed,
	commentCountByFile,
	activeFilePath,
}: {
	details: GitHubPRDetails;
	prCtx: GitHubPRContext;
	viewedFiles: Set<string>;
	onToggleViewed: (path: string, viewed: boolean) => void;
	commentCountByFile: Map<string, number>;
	activeFilePath: string | null;
}) {
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	const viewed = viewedFiles.size;
	const total = details.files.length;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* Progress bar */}
			<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
				<div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
					<div
						className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
						style={{ width: total > 0 ? `${(viewed / total) * 100}%` : "0%" }}
					/>
				</div>
				<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
					{viewed}/{total}
				</span>
			</div>

			{/* File rows */}
			<div className="flex-1 overflow-y-auto py-0.5">
				{details.files.map((file) => {
					const isViewed = viewedFiles.has(file.path);
					const commentCount = commentCountByFile.get(file.path) ?? 0;
					const filename = file.path.split("/").pop() ?? file.path;
					const isActive = file.path === activeFilePath;

					return (
						<div
							key={file.path}
							className={[
								"group flex items-center gap-1.5 px-2 py-[3px]",
								isActive ? "border-l-2 border-l-[var(--accent)] bg-[var(--bg-elevated)]" : "",
							].join(" ")}
						>
							{/* Viewed toggle */}
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onToggleViewed(file.path, !isViewed);
								}}
								className={[
									"flex h-4 w-4 shrink-0 items-center justify-center text-[11px]",
									isViewed
										? "text-[var(--accent)]"
										: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
								].join(" ")}
								title={isViewed ? "Mark as unviewed" : "Mark as viewed"}
							>
								{isViewed ? "\u2713" : "\u25CB"}
							</button>

							{/* File name */}
							<button
								type="button"
								onClick={() => {
									if (!activeWorkspaceId) return;
									openPRReviewFile(
										activeWorkspaceId,
										prCtx,
										file.path,
										detectLanguage(file.path),
									);
								}}
								className={[
									"min-w-0 flex-1 truncate text-left font-mono text-[11px] transition-colors hover:text-[var(--text-secondary)]",
									isViewed
										? "text-[var(--text-quaternary)] line-through"
										: "text-[var(--text-secondary)]",
								].join(" ")}
								title={file.path}
							>
								{filename}
							</button>

							{/* Comment count badge */}
							{commentCount > 0 && (
								<span className="shrink-0 rounded-full bg-[var(--bg-overlay)] px-1.5 text-[10px] font-medium text-yellow-400">
									{commentCount}
								</span>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ── AI Suggestions Badge ─────────────────────────────────────────────────────

function AISuggestionsBadge({
	count,
	onClick,
}: {
	count: number;
	onClick: () => void;
}) {
	if (count === 0) return null;

	return (
		<button
			type="button"
			onClick={onClick}
			className="flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)]"
		>
			<span className="ai-badge">AI</span>
			<span className="flex-1 text-[11px] text-[var(--text-secondary)]">
				{count} suggestion{count !== 1 ? "s" : ""}
			</span>
			<svg
				width="8"
				height="12"
				viewBox="0 0 8 12"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="shrink-0 text-[var(--text-quaternary)]"
				aria-hidden="true"
			>
				<path d="M1 1l5 5-5 5" />
			</svg>
		</button>
	);
}

// ── Submit Review Button ─────────────────────────────────────────────────────

function SubmitReviewButton({
	acceptedCount,
	onClick,
}: {
	acceptedCount: number;
	onClick: () => void;
}) {
	return (
		<div className="shrink-0 border-t border-[var(--border-subtle)] px-3 py-2">
			<button
				type="button"
				onClick={onClick}
				className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-green-900/40 px-3 py-1.5 text-[11px] font-medium text-green-400 transition-colors hover:bg-green-900/60"
			>
				Submit Review
				{acceptedCount > 0 && (
					<span className="rounded-full bg-green-400/20 px-1.5 text-[10px]">
						{acceptedCount}
					</span>
				)}
			</button>
		</div>
	);
}

// ── Root: PRControlRail ──────────────────────────────────────────────────────

export function PRControlRail({ prCtx }: { prCtx: GitHubPRContext }) {
	const [showSubmitModal, setShowSubmitModal] = useState(false);
	const utils = trpc.useUtils();

	// ── PR details ────────────────────────────────────────────────────────
	const { data: details, isLoading } = trpc.github.getPRDetails.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 },
	);

	// ── Viewed files ──────────────────────────────────────────────────────
	const { data: viewedFilesList } = trpc.github.getViewedFiles.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 },
	);
	const viewedFiles = new Set(viewedFilesList ?? []);

	const markViewed = trpc.github.markFileViewed.useMutation({
		onSuccess: () =>
			utils.github.getViewedFiles.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	// ── AI review draft ───────────────────────────────────────────────────
	const prIdentifier = `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;
	const reviewDraftsQuery = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
		staleTime: 5_000,
	});
	const matchingDraft = reviewDraftsQuery.data?.find((d) => d.prIdentifier === prIdentifier);
	const aiDraftQuery = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId: matchingDraft?.id ?? "" },
		{ enabled: !!matchingDraft?.id },
	);

	const mapComment = (
		c: NonNullable<typeof aiDraftQuery.data>["comments"][number],
	): AIDraftThread => ({
		id: `ai-${c.id}`,
		isAIDraft: true as const,
		draftCommentId: c.id,
		path: c.filePath,
		line: c.lineNumber,
		diffSide: (c.side as "LEFT" | "RIGHT") ?? "RIGHT",
		body: c.body,
		status: c.status as AIDraftThread["status"],
		userEdit: c.userEdit ?? null,
		createdAt:
			typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
	});

	const aiThreads: AIDraftThread[] = (aiDraftQuery.data?.comments ?? [])
		.filter((c) => c.status === "pending" || c.status === "edited")
		.map(mapComment);

	const acceptedAiThreads: AIDraftThread[] = (aiDraftQuery.data?.comments ?? [])
		.filter((c) => c.status === "approved")
		.map(mapComment);

	// ── Comment counts by file ────────────────────────────────────────────
	const commentCountByFile = new Map<string, number>();
	if (details) {
		for (const t of details.reviewThreads) {
			if (!t.isResolved) {
				commentCountByFile.set(t.path, (commentCountByFile.get(t.path) ?? 0) + 1);
			}
		}
	}
	for (const t of aiThreads) {
		if (t.status === "pending") {
			commentCountByFile.set(t.path, (commentCountByFile.get(t.path) ?? 0) + 1);
		}
	}

	// ── Active file detection ─────────────────────────────────────────────
	const activeTabId = useTabStore((s) => s.getActiveTabId());
	const allTabs = useTabStore((s) => s.getVisibleTabs());
	const activeTab = allTabs.find((t) => t.id === activeTabId);
	const activeFilePath =
		activeTab?.kind === "pr-review-file" ? activeTab.filePath : null;

	// ── PR overview navigation ────────────────────────────────────────────
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const openPROverview = useTabStore((s) => s.openPROverview);

	// ── Loading state ─────────────────────────────────────────────────────
	if (isLoading || !details) {
		return (
			<div className="flex flex-col gap-2 p-3">
				{[1, 2, 3, 4].map((i) => (
					<div key={i} className="h-3 w-full animate-pulse rounded bg-[var(--bg-elevated)]" />
				))}
			</div>
		);
	}

	const pendingCount = aiThreads.length;
	const acceptedCount = acceptedAiThreads.length;

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<StatusLine details={details} />

			<FileNavigator
				details={details}
				prCtx={prCtx}
				viewedFiles={viewedFiles}
				onToggleViewed={(path, viewed) =>
					markViewed.mutate({
						owner: prCtx.owner,
						repo: prCtx.repo,
						number: prCtx.number,
						filePath: path,
						viewed,
					})
				}
				commentCountByFile={commentCountByFile}
				activeFilePath={activeFilePath}
			/>

			<AISuggestionsBadge
				count={pendingCount}
				onClick={() => {
					if (activeWorkspaceId) {
						openPROverview(activeWorkspaceId, prCtx);
					}
				}}
			/>

			<SubmitReviewButton
				acceptedCount={acceptedCount}
				onClick={() => setShowSubmitModal(true)}
			/>

			{showSubmitModal && (
				<SubmitReviewModal
					prCtx={prCtx}
					aiThreads={acceptedAiThreads}
					pendingCount={pendingCount}
					headCommitOid={details.headCommitOid}
					onClose={() => setShowSubmitModal(false)}
					onSubmitted={() => {
						setShowSubmitModal(false);
						utils.github.getPRDetails.invalidate({
							owner: prCtx.owner,
							repo: prCtx.repo,
							number: prCtx.number,
						});
						aiDraftQuery.refetch();
					}}
				/>
			)}
		</div>
	);
}
