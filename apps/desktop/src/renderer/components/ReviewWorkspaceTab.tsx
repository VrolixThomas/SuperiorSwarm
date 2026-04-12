import { useEffect, useRef, useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ReviewFileGroupCard } from "./ReviewFileGroupCard";
import { ReviewVerdictConfirmation } from "./ReviewVerdictConfirmation";

interface Props {
	workspaceId: string;
	draftId: string;
}

function mapResolution(
	resolution: string | null
): "new" | "resolved" | "still_open" | "regressed" | null {
	switch (resolution) {
		case "new":
			return "new";
		case "resolved-by-code":
			return "resolved";
		case "still-open":
			return "still_open";
		case "incorrectly-resolved":
			return "regressed";
		default:
			return null;
	}
}

function parsePRIdentifier(identifier: string) {
	// Format: "owner/repo#123"
	const match = identifier.match(/^(.+?)\/(.+?)#(\d+)$/);
	if (!match) return null;
	return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

export function ReviewWorkspaceTab({ workspaceId, draftId }: Props) {
	const utils = trpc.useUtils();
	const [showVerdictConfirmation, setShowVerdictConfirmation] = useState(false);
	const [summaryExpanded, setSummaryExpanded] = useState(true);
	const [historyExpanded, setHistoryExpanded] = useState(false);

	const { data: draft, isLoading } = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId },
		{
			refetchInterval: (query) => {
				const status = query.state.data?.status;
				return status === "queued" || status === "in_progress" ? 3000 : false;
			},
		}
	);

	const { data: chainHistory } = trpc.aiReview.getReviewChainHistory.useQuery(
		{ reviewChainId: draft?.reviewChainId ?? "" },
		{ enabled: !!draft?.reviewChainId }
	);

	const cancelMutation = trpc.aiReview.cancelReview.useMutation({
		onSuccess: () => utils.aiReview.invalidate(),
	});
	const updateComment = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: () => utils.aiReview.invalidate(),
	});
	const batchUpdate = trpc.aiReview.batchUpdateDraftComments.useMutation({
		onSuccess: () => utils.aiReview.invalidate(),
	});
	const submitReview = trpc.aiReview.submitReview.useMutation({
		onSuccess: () => {
			utils.aiReview.invalidate();
			setShowVerdictConfirmation(false);
		},
	});
	const dismissMutation = trpc.aiReview.dismissReview.useMutation({
		onSuccess: () => utils.aiReview.invalidate(),
	});

	// Auto-focus when review completes
	const prevStatusRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (prevStatusRef.current === "in_progress" && draft?.status === "ready") {
			useTabStore.getState().setActiveTab(`review-workspace-${draftId}`);
		}
		prevStatusRef.current = draft?.status;
	}, [draft?.status, draftId]);

	if (isLoading || !draft) {
		return <div className="p-6 text-[var(--text-secondary)]">Loading…</div>;
	}

	const isSolving = draft.status === "queued" || draft.status === "in_progress";
	const isCancelled = draft.status === "cancelled";
	const isSubmitted = draft.status === "submitted";
	const comments = draft.comments ?? [];

	// Counts
	const approvedCount = comments.filter((c) => c.status === "approved").length;
	const rejectedCount = comments.filter((c) => c.status === "rejected").length;
	const pendingCount = comments.filter(
		(c) => c.status !== "approved" && c.status !== "rejected" && c.status !== "submitted"
	).length;
	const totalNonRejected = comments.length - rejectedCount;
	const approvalPct = totalNonRejected > 0 ? (approvedCount / totalNonRejected) * 100 : 0;

	// AI verdict suggestion
	const aiSuggestion =
		rejectedCount > 0
			? "Request Changes"
			: pendingCount === 0 && approvedCount > 0
				? "Approve"
				: "Comment";

	// Group comments by file, sorted alphabetically
	const commentsByFile = new Map<string, typeof comments>();
	for (const comment of comments) {
		const existing = commentsByFile.get(comment.filePath) ?? [];
		existing.push(comment);
		commentsByFile.set(comment.filePath, existing);
	}
	const sortedFiles = Array.from(commentsByFile.entries()).sort(([a], [b]) =>
		a.localeCompare(b)
	);

	// Find first file with pending comments for defaultExpanded
	const firstPendingFile = sortedFiles.find(([, fileComments]) =>
		fileComments.some(
			(c) => c.status !== "approved" && c.status !== "rejected" && c.status !== "submitted"
		)
	)?.[0];

	// Build PRContext for openPRReviewFile
	const parsed = parsePRIdentifier(draft.prIdentifier);

	const handleOpenInDiff = (filePath: string) => {
		if (!parsed) return;
		const activeWorkspaceId = useTabStore.getState().activeWorkspaceId;
		if (!activeWorkspaceId) return;
		useTabStore.getState().openPRReviewFile(
			activeWorkspaceId,
			{
				provider: (draft.prProvider as "github" | "bitbucket") ?? "github",
				owner: parsed.owner,
				repo: parsed.repo,
				number: parsed.number,
				title: draft.prTitle,
				sourceBranch: draft.sourceBranch,
				targetBranch: draft.targetBranch,
				repoPath: "", // TODO: resolve from workspace → project → repoPath
			},
			filePath,
			detectLanguage(filePath)
		);
	};

	const statusMessage = isSolving
		? "Reviewing..."
		: isCancelled
			? "Cancelled"
			: isSubmitted
				? "Submitted"
				: pendingCount > 0
					? `${pendingCount} comments pending review`
					: "All comments reviewed";

	return (
		<div className="flex flex-col h-full overflow-hidden">
			<div className="flex-1 overflow-y-auto px-7 pt-[22px] pb-[18px]">
				{/* 1. PR Header */}
				<PRHeader
					draft={draft}
					isSolving={isSolving}
					onCancel={() => cancelMutation.mutate({ draftId })}
				/>

				{/* 2. Status Strip */}
				<StatusStrip
					approvedCount={approvedCount}
					rejectedCount={rejectedCount}
					pendingCount={pendingCount}
					approvalPct={approvalPct}
					roundNumber={draft.roundNumber}
					aiSuggestion={aiSuggestion}
				/>

				{/* 3. AI Summary */}
				{draft.summaryMarkdown && (
					<div className="mb-[16px]">
						<div
							onClick={() => setSummaryExpanded(!summaryExpanded)}
							className="flex items-center gap-[6px] cursor-pointer select-none mb-[6px]"
						>
							<span
								className="text-[10px] text-[var(--text-tertiary)] w-[14px] text-center transition-transform duration-[150ms]"
								style={{
									transform: summaryExpanded ? "rotate(90deg)" : "none",
								}}
							>
								›
							</span>
							<span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
								AI Review Summary
							</span>
						</div>
						{summaryExpanded && (
							<div className="bg-[var(--bg-elevated)] rounded-[6px] p-[10px_14px]">
								<MarkdownRenderer content={draft.summaryMarkdown} />
							</div>
						)}
					</div>
				)}

				{/* 4. File Groups */}
				<div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)] mb-2">
					{sortedFiles.length} Files
				</div>
				{sortedFiles.map(([filePath, fileComments]) => (
					<ReviewFileGroupCard
						key={filePath}
						filePath={filePath}
						comments={fileComments.map((c) => ({
							id: c.id,
							lineNumber: c.lineNumber,
							body: c.body,
							status: c.status,
							userEdit: c.userEdit,
							roundDelta: mapResolution(c.resolution),
						}))}
						defaultExpanded={filePath === firstPendingFile}
						onApprove={(commentId) =>
							updateComment.mutate({ commentId, status: "approved" })
						}
						onReject={(commentId) =>
							updateComment.mutate({ commentId, status: "rejected" })
						}
						onEdit={(commentId, newBody) =>
							updateComment.mutate({
								commentId,
								status: "edited",
								userEdit: newBody,
							})
						}
						onApproveAll={(commentIds) =>
							batchUpdate.mutate({ commentIds, status: "approved" })
						}
						onOpenInDiff={handleOpenInDiff}
					/>
				))}

				{/* 5. Review History */}
				{chainHistory && chainHistory.length > 1 && (
					<div className="mt-[16px]">
						<div
							onClick={() => setHistoryExpanded(!historyExpanded)}
							className="flex items-center gap-[6px] cursor-pointer select-none mb-[6px]"
						>
							<span
								className="text-[10px] text-[var(--text-tertiary)] w-[14px] text-center transition-transform duration-[150ms]"
								style={{
									transform: historyExpanded ? "rotate(90deg)" : "none",
								}}
							>
								›
							</span>
							<span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
								Review History · {chainHistory.length} rounds
							</span>
						</div>
						{historyExpanded && (
							<div className="bg-[var(--bg-elevated)] rounded-[6px] p-[10px_14px]">
								{chainHistory.map((entry) => (
									<div
										key={entry.id}
										className="text-[11px] text-[var(--text-secondary)] py-[3px]"
									>
										Round {entry.roundNumber} ·{" "}
										{new Date(entry.createdAt).toLocaleDateString("en-US", {
											month: "short",
											day: "numeric",
										})}{" "}
										· {entry.commentCount} comments ·{" "}
										<span className="capitalize">{entry.status}</span>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>

			{/* 6. Bottom Bar */}
			<BottomBar
				statusMessage={statusMessage}
				isSolving={isSolving}
				isSubmitted={isSubmitted}
				pendingCount={pendingCount}
				showVerdictConfirmation={showVerdictConfirmation}
				isSubmitting={submitReview.isPending}
				onDismiss={() => dismissMutation.mutate({ workspaceId })}
				onShowVerdict={() => setShowVerdictConfirmation(true)}
				onCancelVerdict={() => setShowVerdictConfirmation(false)}
				onSubmitVerdict={(verdict, body) =>
					submitReview.mutate({ draftId, verdict, body })
				}
			/>
		</div>
	);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PRHeader({
	draft,
	isSolving,
	onCancel,
}: {
	draft: {
		prIdentifier: string;
		sourceBranch: string;
		targetBranch: string;
		prTitle: string;
	};
	isSolving: boolean;
	onCancel: () => void;
}) {
	return (
		<div className="mb-5">
			<div className="flex justify-between items-center mb-[6px]">
				<div className="flex items-center gap-2">
					<span className="[font-family:var(--font-mono)] text-[11.5px] text-[var(--text-tertiary)]">
						{draft.prIdentifier}
					</span>
					<span className="[font-family:var(--font-mono)] inline-flex items-center gap-[5px] px-2 py-[2px] bg-[var(--bg-elevated)] rounded-[4px] text-[10.5px] text-[var(--text-secondary)]">
						{draft.sourceBranch}
						<span className="text-[var(--text-tertiary)] text-[9px]">→</span>
						{draft.targetBranch}
					</span>
				</div>
				{isSolving && (
					<button
						type="button"
						onClick={onCancel}
						className="px-[10px] py-[4px] rounded-[6px] text-[11.5px] font-medium text-[var(--danger)] bg-[var(--danger-subtle)] border-none cursor-pointer"
					>
						Cancel
					</button>
				)}
			</div>
			<div className="text-[17px] font-semibold tracking-[-0.03em] leading-[1.35]">
				{draft.prTitle}
			</div>
		</div>
	);
}

function StatusPill({
	color,
	bg,
	count,
	label,
}: {
	color: string;
	bg: string;
	count: number;
	label: string;
}) {
	return (
		<span
			style={{ background: bg, color }}
			className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium"
		>
			<span className="w-1 h-1 rounded-full bg-current" />
			{count} {label}
		</span>
	);
}

function StatusStrip({
	approvedCount,
	rejectedCount,
	pendingCount,
	approvalPct,
	roundNumber,
	aiSuggestion,
}: {
	approvedCount: number;
	rejectedCount: number;
	pendingCount: number;
	approvalPct: number;
	roundNumber: number;
	aiSuggestion: string;
}) {
	return (
		<div className="mb-[22px]">
			<div className="flex gap-[5px] mb-[10px]">
				{approvedCount > 0 && (
					<StatusPill
						color="var(--success)"
						bg="var(--success-subtle)"
						count={approvedCount}
						label="approved"
					/>
				)}
				{rejectedCount > 0 && (
					<StatusPill
						color="var(--danger)"
						bg="var(--danger-subtle)"
						count={rejectedCount}
						label="rejected"
					/>
				)}
				{pendingCount > 0 && (
					<StatusPill
						color="var(--text-tertiary)"
						bg="var(--bg-elevated)"
						count={pendingCount}
						label="pending"
					/>
				)}
			</div>
			<div className="flex justify-between items-center mb-[5px]">
				<span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
					Round {roundNumber}
				</span>
				<span className="text-[10.5px] text-[var(--text-tertiary)]">
					AI suggests: {aiSuggestion}
				</span>
			</div>
			<div className="h-[2px] bg-[var(--bg-elevated)] rounded-[1px] overflow-hidden">
				<div
					className="h-full bg-[var(--success)] rounded-[1px]"
					style={{ width: `${approvalPct}%`, transition: "width 0.5s ease" }}
				/>
			</div>
		</div>
	);
}

function BottomBar({
	statusMessage,
	isSolving,
	isSubmitted,
	pendingCount,
	showVerdictConfirmation,
	isSubmitting,
	onDismiss,
	onShowVerdict,
	onCancelVerdict,
	onSubmitVerdict,
}: {
	statusMessage: string;
	isSolving: boolean;
	isSubmitted: boolean;
	pendingCount: number;
	showVerdictConfirmation: boolean;
	isSubmitting: boolean;
	onDismiss: () => void;
	onShowVerdict: () => void;
	onCancelVerdict: () => void;
	onSubmitVerdict: (verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES", body: string) => void;
}) {
	if (showVerdictConfirmation) {
		return (
			<ReviewVerdictConfirmation
				onSubmit={onSubmitVerdict}
				onCancel={onCancelVerdict}
				isSubmitting={isSubmitting}
			/>
		);
	}

	return (
		<div className="border-t border-[var(--border-subtle)] px-7 py-3 flex items-center justify-between">
			<span className="text-[11px] text-[var(--text-tertiary)]">{statusMessage}</span>
			<div className="flex items-center gap-[6px]">
				{!isSubmitted && (
					<button
						type="button"
						onClick={onDismiss}
						className="px-[14px] py-[6px] rounded-[6px] text-[12px] font-medium text-[var(--text-secondary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
					>
						Dismiss
					</button>
				)}
				{!isSolving && !isSubmitted && (
					<button
						type="button"
						onClick={onShowVerdict}
						disabled={pendingCount > 0}
						className={[
							"px-4 py-[6px] rounded-[6px] text-[12px] font-semibold border-none",
							pendingCount === 0
								? "cursor-pointer bg-[var(--success)] text-white"
								: "cursor-not-allowed bg-[var(--bg-active)] text-[var(--text-tertiary)]",
						].join(" ")}
					>
						Submit Review
					</button>
				)}
			</div>
		</div>
	);
}
