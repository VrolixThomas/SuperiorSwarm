import { useEffect, useMemo, useRef, useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type {
	AIDraftThread,
	FileGroupItem,
	GitHubPRDetails,
	GitHubReviewThread,
	PRContext,
	UnifiedThread,
} from "../../shared/github-types";
import { formatRelativeTime } from "../../shared/tickets";
import { prReviewSessionKey, usePRReviewSessionStore } from "../stores/pr-review-session-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ReviewFileGroupCard } from "./ReviewFileGroupCard";
import { ReviewVerdictConfirmation } from "./ReviewVerdictConfirmation";

// ── PRHeader ──────────────────────────────────────────────────────────────────

function PRHeader({ details, prCtx }: { details: GitHubPRDetails; prCtx: PRContext }) {
	const stateColor: Record<string, string> = {
		OPEN: "bg-[var(--success-subtle)] text-[var(--color-success)]",
		CLOSED: "bg-[var(--danger-subtle)] text-[var(--color-danger)]",
		MERGED: "bg-[var(--purple-subtle)] text-[var(--color-purple)]",
	};

	const decisionLabel: Record<string, string> = {
		APPROVED: "Approved",
		CHANGES_REQUESTED: "Changes requested",
		REVIEW_REQUIRED: "Review required",
	};

	const decisionColor: Record<string, string> = {
		APPROVED: "bg-[var(--success-subtle)] text-[var(--color-success)]",
		CHANGES_REQUESTED: "bg-[var(--danger-subtle)] text-[var(--color-danger)]",
		REVIEW_REQUIRED: "bg-[var(--warning-subtle)] text-[var(--color-warning)]",
	};

	const reviewerDecisionIcon: Record<string, string> = {
		APPROVED: "\u2713",
		CHANGES_REQUESTED: "\u2717",
		COMMENTED: "\u25CB",
		PENDING: "\u25CB",
	};

	const reviewerDecisionColor: Record<string, string> = {
		APPROVED: "text-[var(--color-success)]",
		CHANGES_REQUESTED: "text-[var(--color-danger)]",
		COMMENTED: "text-[var(--text-quaternary)]",
		PENDING: "text-[var(--text-quaternary)]",
	};

	return (
		<div className="border-b border-[var(--border-subtle)] px-6 py-5">
			{/* Title */}
			<h1 className="text-[18px] font-semibold leading-tight text-[var(--text)]">
				{details.title}
			</h1>

			{/* Metadata line */}
			<div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-tertiary)]">
				<span>#{prCtx.number}</span>
				<span>by</span>
				<span className="text-[var(--text-secondary)]">{details.author}</span>
				<span className="text-[var(--text-quaternary)]">&middot;</span>
				<span className="font-mono text-[11px]">
					{details.targetBranch} &larr; {details.sourceBranch}
				</span>
				<span className="text-[var(--text-quaternary)]">&middot;</span>
				<span>
					{details.files.length} file{details.files.length !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Status pills */}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				{/* State pill */}
				<span
					className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${stateColor[details.state] ?? ""}`}
				>
					{details.isDraft
						? "Draft"
						: details.state.charAt(0) + details.state.slice(1).toLowerCase()}
				</span>

				{/* Review decision pill */}
				{details.reviewDecision && (
					<span
						className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${decisionColor[details.reviewDecision] ?? ""}`}
					>
						{decisionLabel[details.reviewDecision] ?? details.reviewDecision}
					</span>
				)}

				{/* CI state pill */}
				{details.ciState && (
					<span
						className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
							details.ciState === "SUCCESS"
								? "bg-[var(--success-subtle)] text-[var(--color-success)]"
								: details.ciState === "FAILURE"
									? "bg-[var(--danger-subtle)] text-[var(--color-danger)]"
									: "bg-[var(--warning-subtle)] text-[var(--color-warning)]"
						}`}
					>
						{details.ciState === "SUCCESS"
							? "\u2713 CI passed"
							: details.ciState === "FAILURE"
								? "\u2717 CI failed"
								: "\u25CF CI pending"}
					</span>
				)}
			</div>

			{/* Reviewer avatars */}
			{details.reviewers.length > 0 && (
				<div className="mt-3 flex items-center gap-3">
					{details.reviewers.map((r) => (
						<div
							key={r.login}
							className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"
						>
							<div className="relative">
								{r.avatarUrl ? (
									<img src={r.avatarUrl} alt={r.login} className="h-5 w-5 rounded-full" />
								) : (
									<div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[9px] font-medium text-[var(--text-tertiary)]">
										{r.login.charAt(0).toUpperCase()}
									</div>
								)}
								{r.decision && (
									<span
										className={`absolute -bottom-0.5 -right-0.5 text-[8px] font-bold ${reviewerDecisionColor[r.decision] ?? ""}`}
									>
										{reviewerDecisionIcon[r.decision] ?? ""}
									</span>
								)}
							</div>
							<span>{r.login}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── AISummaryCard ─────────────────────────────────────────────────────────────

function AISummaryCard({ summaryMarkdown }: { summaryMarkdown: string }) {
	const [collapsed, setCollapsed] = useState(false);

	return (
		<div className="mx-6 mt-5 overflow-hidden rounded-[8px] border border-[var(--border-subtle)]">
			<button
				type="button"
				onClick={() => setCollapsed((v) => !v)}
				className="flex w-full items-center gap-2 bg-[var(--bg-elevated)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-overlay)]"
			>
				<span className="ai-badge">AI</span>
				<span className="flex-1 text-[12px] font-medium text-[var(--text-secondary)]">
					Review Summary
				</span>
				<span
					className="text-[10px] text-[var(--text-quaternary)] transition-transform"
					style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
				>
					&#9660;
				</span>
			</button>
			{!collapsed && (
				<div className="bg-[var(--bg-surface)] px-4 py-3">
					<MarkdownRenderer content={summaryMarkdown} />
				</div>
			)}
		</div>
	);
}

// ── AI Comment Card ───────────────────────────────────────────────────────────

function AICommentCard({
	thread,
	prCtx,
	onAccept,
	onDismiss,
}: {
	thread: AIDraftThread;
	prCtx: PRContext;
	onAccept: (id: string) => void;
	onDismiss: (id: string) => void;
}) {
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const selectFile = usePRReviewSessionStore((s) => s.selectFile);
	const selectThread = usePRReviewSessionStore((s) => s.selectThread);
	const sessionKey = prReviewSessionKey(
		activeWorkspaceId ?? "",
		`${prCtx.owner}/${prCtx.repo}#${prCtx.number}`
	);

	const filename = thread.path.split("/").pop() ?? thread.path;

	const handleNavigate = () => {
		if (!activeWorkspaceId) return;
		selectFile(sessionKey, thread.path);
		selectThread(sessionKey, thread.id);
		useTabStore
			.getState()
			.swapPRReviewFile(activeWorkspaceId, prCtx, thread.path, detectLanguage(thread.path));
	};

	return (
		<div className="overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5">
				<span className="ai-badge">AI</span>
				<button
					type="button"
					onClick={handleNavigate}
					className="font-mono text-[10px] text-[var(--text-quaternary)] hover:text-[var(--accent)] transition-colors"
				>
					{filename}
					{thread.line != null && `:${thread.line}`}
				</button>
				<div className="flex-1" />
				<span className="text-[10px] text-[var(--text-quaternary)]">
					{formatRelativeTime(thread.createdAt)}
				</span>
			</div>
			<div className="px-3 py-2">
				<MarkdownRenderer content={thread.userEdit ?? thread.body} />
			</div>
			{(thread.status === "pending" || thread.status === "edited") && (
				<div className="flex gap-1.5 border-t border-[var(--border-subtle)] px-3 py-1.5">
					<button
						type="button"
						onClick={() => onAccept(thread.draftCommentId)}
						className="rounded-[4px] px-2.5 py-0.5 text-[10px] font-medium bg-[var(--success-subtle)] text-[var(--color-success)] hover:opacity-80"
					>
						Accept
					</button>
					<button
						type="button"
						onClick={() => onDismiss(thread.draftCommentId)}
						className="rounded-[4px] px-2.5 py-0.5 text-[10px] bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:opacity-80"
					>
						Dismiss
					</button>
				</div>
			)}
		</div>
	);
}

// ── GitHub Thread Card ────────────────────────────────────────────────────────

function GitHubThreadCard({
	thread,
	prCtx,
	onReply,
	onResolve,
}: {
	thread: GitHubReviewThread;
	prCtx: PRContext;
	onReply: (threadId: string, body: string) => void;
	onResolve: (threadId: string) => void;
}) {
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const selectFile = usePRReviewSessionStore((s) => s.selectFile);
	const selectThread = usePRReviewSessionStore((s) => s.selectThread);
	const sessionKey = prReviewSessionKey(
		activeWorkspaceId ?? "",
		`${prCtx.owner}/${prCtx.repo}#${prCtx.number}`
	);
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyBody, setReplyBody] = useState("");
	const replyRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (replyOpen) replyRef.current?.focus();
	}, [replyOpen]);

	const filename = thread.path.split("/").pop() ?? thread.path;

	const handleNavigate = () => {
		if (!activeWorkspaceId) return;
		selectFile(sessionKey, thread.path);
		selectThread(sessionKey, thread.id);
		useTabStore
			.getState()
			.swapPRReviewFile(activeWorkspaceId, prCtx, thread.path, detectLanguage(thread.path));
	};

	return (
		<div
			className={`overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] ${
				thread.isResolved ? "opacity-50" : ""
			}`}
		>
			{/* Header */}
			<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5">
				<button
					type="button"
					onClick={handleNavigate}
					className="font-mono text-[10px] text-[var(--text-quaternary)] hover:text-[var(--accent)] transition-colors"
				>
					{filename}
					{thread.line != null && `:${thread.line}`}
				</button>
				<div className="flex-1" />
				{thread.isResolved ? (
					<span className="text-[10px] text-[var(--color-success)]">Resolved</span>
				) : (
					<button
						type="button"
						onClick={() => onResolve(thread.id)}
						className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)] transition-colors"
					>
						Resolve
					</button>
				)}
			</div>

			{/* Comments */}
			{thread.comments.map((c) => (
				<div
					key={c.id}
					className="border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
				>
					<div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
						<span className="font-medium text-[var(--text-secondary)]">{c.author}</span>
						<span className="text-[var(--text-quaternary)]">{formatRelativeTime(c.createdAt)}</span>
					</div>
					<MarkdownRenderer content={c.body} />
				</div>
			))}

			{/* Reply */}
			{!thread.isResolved && (
				<div className="border-t border-[var(--border-subtle)]">
					{!replyOpen ? (
						<button
							type="button"
							onClick={() => setReplyOpen(true)}
							className="w-full px-3 py-1.5 text-left text-[10px] text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)] transition-colors"
						>
							Reply...
						</button>
					) : (
						<div className="flex flex-col gap-1.5 p-2">
							<textarea
								ref={replyRef}
								value={replyBody}
								onChange={(e) => setReplyBody(e.target.value)}
								rows={2}
								placeholder="Write a reply..."
								className="w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]"
							/>
							<div className="flex gap-1.5">
								<button
									type="button"
									onClick={() => {
										if (replyBody.trim()) {
											onReply(thread.id, replyBody.trim());
											setReplyBody("");
											setReplyOpen(false);
										}
									}}
									className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-foreground)] hover:opacity-80"
								>
									Reply
								</button>
								<button
									type="button"
									onClick={() => {
										setReplyOpen(false);
										setReplyBody("");
									}}
									className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
								>
									Cancel
								</button>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ── Unified Comments Feed ─────────────────────────────────────────────────────

function CommentsFeed({
	details,
	prCtx,
	aiThreads,
}: {
	details: GitHubPRDetails;
	prCtx: PRContext;
	aiThreads: AIDraftThread[];
}) {
	const utils = trpc.useUtils();

	const invalidateDrafts = () => {
		utils.aiReview.getReviewDrafts.invalidate();
		utils.aiReview.getReviewDraft.invalidate();
	};

	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: invalidateDrafts,
	});

	const addComment = trpc.github.addReviewComment.useMutation({
		onSuccess: () =>
			utils.projects.getPRDetails.invalidate({
				provider: prCtx.provider,
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	const resolveThread = trpc.github.resolveThread.useMutation({
		onSuccess: () =>
			utils.projects.getPRDetails.invalidate({
				provider: prCtx.provider,
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	const handleAccept = (draftCommentId: string) => {
		updateDraftComment.mutate({ commentId: draftCommentId, status: "user-pending" });
	};

	const handleDismiss = (draftCommentId: string) => {
		updateDraftComment.mutate({ commentId: draftCommentId, status: "rejected" });
	};

	const handleReply = (threadId: string, body: string) => {
		addComment.mutate({ threadId, body });
	};

	const handleResolve = (threadId: string) => {
		resolveThread.mutate({ threadId });
	};

	const allThreads: UnifiedThread[] = useMemo(() => {
		const ghThreads: UnifiedThread[] = details.reviewThreads.map((t) => ({
			...t,
			isAIDraft: false as const,
		}));
		return [...ghThreads, ...aiThreads];
	}, [details.reviewThreads, aiThreads]);

	// Separate unresolved and resolved
	const { unresolved, resolved } = useMemo(() => {
		const unresolvedList: UnifiedThread[] = [];
		const resolvedList: UnifiedThread[] = [];
		for (const t of allThreads) {
			if (t.isAIDraft) {
				unresolvedList.push(t);
			} else {
				const gh = t as GitHubReviewThread & { isAIDraft?: false };
				if (gh.isResolved) {
					resolvedList.push(t);
				} else {
					unresolvedList.push(t);
				}
			}
		}
		return { unresolved: unresolvedList, resolved: resolvedList };
	}, [allThreads]);

	if (allThreads.length === 0) {
		return (
			<div className="mx-6 mt-5 text-[12px] text-[var(--text-quaternary)]">No comments yet.</div>
		);
	}

	const renderThread = (t: UnifiedThread) => {
		if (t.isAIDraft) {
			return (
				<AICommentCard
					key={t.id}
					thread={t}
					prCtx={prCtx}
					onAccept={handleAccept}
					onDismiss={handleDismiss}
				/>
			);
		}
		return (
			<GitHubThreadCard
				key={t.id}
				thread={t as GitHubReviewThread}
				prCtx={prCtx}
				onReply={handleReply}
				onResolve={handleResolve}
			/>
		);
	};

	return (
		<div className="mx-6 mt-5">
			<h2 className="mb-3 text-[13px] font-medium text-[var(--text-secondary)]">
				Comments ({allThreads.length})
			</h2>
			<div className="flex flex-col gap-2.5">
				{unresolved.map(renderThread)}
				{resolved.length > 0 && (
					<>
						<div className="mt-2 text-[10px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
							Resolved ({resolved.length})
						</div>
						{resolved.map(renderThread)}
					</>
				)}
			</div>
		</div>
	);
}

// ── Helpers & sub-components for review mode ─────────────────────────────────

const EMPTY_COMMENTS: never[] = [];

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

function StatusStrip({
	approvedCount,
	rejectedCount,
	pendingCount,
	approvalPct,
	roundNumber,
	aiSuggestion,
	isSolving,
	onCancel,
}: {
	approvedCount: number;
	rejectedCount: number;
	pendingCount: number;
	approvalPct: number;
	roundNumber: number;
	aiSuggestion: string;
	isSolving: boolean;
	onCancel: () => void;
}) {
	return (
		<div className="mx-6 mt-4 mb-1">
			<div className="flex items-center gap-[5px] mb-[8px]">
				{isSolving && (
					<span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)]">
						<span className="w-1 h-1 rounded-full bg-current animate-pulse" />
						Reviewing…
					</span>
				)}
				{approvedCount > 0 && (
					<span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium bg-[var(--success-subtle)] text-[var(--success)]">
						<span className="w-1 h-1 rounded-full bg-current" />
						{approvedCount} approved
					</span>
				)}
				{rejectedCount > 0 && (
					<span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium bg-[var(--danger-subtle)] text-[var(--danger)]">
						<span className="w-1 h-1 rounded-full bg-current" />
						{rejectedCount} rejected
					</span>
				)}
				{pendingCount > 0 && (
					<span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
						<span className="w-1 h-1 rounded-full bg-current" />
						{pendingCount} pending
					</span>
				)}
				{isSolving && (
					<button
						type="button"
						onClick={onCancel}
						className="ml-auto px-[10px] py-[3px] rounded-[6px] text-[11px] font-medium text-[var(--danger)] bg-[var(--danger-subtle)] border-none cursor-pointer"
					>
						Cancel
					</button>
				)}
			</div>
			<div className="flex justify-between items-center mb-[5px]">
				<span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
					Round {roundNumber}
				</span>
				{!isSolving && (
					<span className="text-[10.5px] text-[var(--text-tertiary)]">
						AI suggests: {aiSuggestion}
					</span>
				)}
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

function ReviewBottomBar({
	statusMessage,
	isSolving,
	showVerdictConfirmation,
	isSubmitting,
	onDismiss,
	onShowVerdict,
	onCancelVerdict,
	onSubmitVerdict,
}: {
	statusMessage: string;
	isSolving: boolean;
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
		<div className="border-t border-[var(--border-subtle)] px-6 py-3 flex items-center justify-between">
			<span className="text-[11px] text-[var(--text-tertiary)]">{statusMessage}</span>
			<div className="flex items-center gap-[6px]">
				<button
					type="button"
					onClick={onDismiss}
					className="px-[14px] py-[6px] rounded-[6px] text-[12px] font-medium text-[var(--text-secondary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
				>
					Dismiss
				</button>
				{!isSolving && (
					<button
						type="button"
						onClick={onShowVerdict}
						className="px-4 py-[6px] rounded-[6px] text-[12px] font-semibold border-none cursor-pointer bg-[var(--success)] text-[var(--accent-foreground)]"
					>
						Submit Review
					</button>
				)}
			</div>
		</div>
	);
}

// ── Root: PROverviewTab ───────────────────────────────────────────────────────

export function PROverviewTab({ prCtx }: { prCtx: PRContext }) {
	const { data: details, isLoading } = trpc.projects.getPRDetails.useQuery(
		{ provider: prCtx.provider, owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);

	// ── AI review draft queries ───────────────────────────────────────────
	const prIdentifier = `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;
	const reviewDraftsQuery = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
		staleTime: 5_000,
	});
	const matchingDraft = (() => {
		const drafts = reviewDraftsQuery.data?.filter((d) => d.prIdentifier === prIdentifier) ?? [];
		if (drafts.length === 0) return undefined;
		const statusPriority: Record<string, number> = {
			ready: 0,
			in_progress: 1,
			queued: 2,
			submitted: 3,
			failed: 4,
		};
		return drafts.sort((a, b) => {
			const pa = statusPriority[a.status] ?? 5;
			const pb = statusPriority[b.status] ?? 5;
			if (pa !== pb) return pa - pb;
			return (b.roundNumber ?? 1) - (a.roundNumber ?? 1);
		})[0];
	})();
	const aiDraftQuery = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId: matchingDraft?.id ?? "" },
		{ enabled: !!matchingDraft?.id }
	);

	// ── Review-mode hooks ─────────────────────────────────────────────────
	const utils = trpc.useUtils();
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const selectFile = usePRReviewSessionStore((s) => s.selectFile);

	const sessionKey = prReviewSessionKey(
		activeWorkspaceId ?? "",
		`${prCtx.owner}/${prCtx.repo}#${prCtx.number}`
	);
	const setOverviewScroll = usePRReviewSessionStore((s) => s.setOverviewScroll);
	const scrollRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const top = usePRReviewSessionStore.getState().sessions.get(sessionKey)?.overviewScrollTop ?? 0;
		if (top > 0) el.scrollTop = top;

		let raf = 0;
		const onScroll = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				setOverviewScroll(sessionKey, el.scrollTop);
			});
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			cancelAnimationFrame(raf);
			el.removeEventListener("scroll", onScroll);
			setOverviewScroll(sessionKey, el.scrollTop);
		};
	}, [sessionKey, setOverviewScroll, isLoading]);

	const [showVerdictConfirmation, setShowVerdictConfirmation] = useState(false);
	const [historyExpanded, setHistoryExpanded] = useState(false);

	const hasActiveDraft =
		!!matchingDraft &&
		matchingDraft.status !== "dismissed" &&
		matchingDraft.status !== "submitted" &&
		matchingDraft.status !== "failed";

	const { data: chainHistory } = trpc.aiReview.getReviewChainHistory.useQuery(
		{ reviewChainId: aiDraftQuery.data?.reviewChainId ?? "" },
		{ enabled: hasActiveDraft && !!aiDraftQuery.data?.reviewChainId }
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
	const dismissPending = trpc.aiReview.dismissPendingComments.useMutation({
		onSuccess: () => utils.aiReview.invalidate(),
	});
	const addReplyComment = trpc.github.addReviewComment.useMutation({
		onSuccess: () =>
			utils.projects.getPRDetails.invalidate({
				provider: prCtx.provider,
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});
	const resolveThread = trpc.github.resolveThread.useMutation({
		onSuccess: () =>
			utils.projects.getPRDetails.invalidate({
				provider: prCtx.provider,
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	const mapComment = (
		c: NonNullable<typeof aiDraftQuery.data>["comments"][number]
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
		createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
		resolution: c.resolution ?? null,
		roundNumber: c.roundNumber ?? undefined,
	});

	// Show AI suggestions (pending/edited) and user-pending drafts
	const aiThreads: AIDraftThread[] = (aiDraftQuery.data?.comments ?? [])
		.filter((c) => c.status === "pending" || c.status === "edited" || c.status === "user-pending")
		.map(mapComment);

	const summaryMarkdown = aiDraftQuery.data?.summaryMarkdown ?? null;

	// ── Review-mode computed values ───────────────────────────────────────
	const draftComments = aiDraftQuery.data?.comments ?? EMPTY_COMMENTS;
	const isSolving =
		hasActiveDraft && (matchingDraft.status === "queued" || matchingDraft.status === "in_progress");
	const isCancelled = hasActiveDraft && matchingDraft.status === "cancelled";
	const draftId = matchingDraft?.id ?? "";

	// Comment counts (AI draft only)
	let approvedCount = 0;
	let rejectedCount = 0;
	let pendingCount = 0;
	if (hasActiveDraft) {
		for (const c of draftComments) {
			if (c.status === "approved") approvedCount++;
			else if (c.status === "rejected") rejectedCount++;
			else if (c.status !== "submitted") pendingCount++;
		}
	}
	const totalNonRejected = draftComments.length - rejectedCount;
	const approvalPct = totalNonRejected > 0 ? (approvedCount / totalNonRejected) * 100 : 0;

	const aiSuggestion =
		rejectedCount > 0
			? "Request Changes"
			: pendingCount === 0 && approvedCount > 0
				? "Approve"
				: "Comment";

	// ── Grouped-by-file items merging AI + GitHub threads ─────────────────
	const groupedByFile = useMemo(() => {
		if (!hasActiveDraft || !details) return null;

		const map = new Map<string, FileGroupItem[]>();

		// AI draft comments
		for (const c of draftComments) {
			const items = map.get(c.filePath) ?? [];
			items.push({
				kind: "ai-draft",
				id: c.id,
				lineNumber: c.lineNumber,
				body: c.body,
				status: c.status as Extract<FileGroupItem, { kind: "ai-draft" }>["status"],
				userEdit: c.userEdit ?? null,
				roundDelta: mapResolution(c.resolution ?? null),
			});
			map.set(c.filePath, items);
		}

		// GitHub threads
		for (const t of details.reviewThreads) {
			const items = map.get(t.path) ?? [];
			items.push({
				kind: "github-thread",
				id: t.id,
				lineNumber: t.line,
				isResolved: t.isResolved,
				comments: t.comments.map((c) => ({
					id: c.id,
					body: c.body,
					author: c.author,
					createdAt: c.createdAt,
				})),
			});
			map.set(t.path, items);
		}

		// Sort items within each file by line number
		for (const [, items] of map) {
			items.sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
		}

		return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
	}, [hasActiveDraft, draftComments, details]);

	const firstPendingFile = groupedByFile?.find(([, items]) =>
		items.some(
			(i) =>
				i.kind === "ai-draft" &&
				i.status !== "approved" &&
				i.status !== "rejected" &&
				i.status !== "submitted"
		)
	)?.[0];

	// ── Loading state ─────────────────────────────────────────────────────
	if (isLoading || !details) {
		return (
			<div className="flex h-full items-center justify-center bg-[var(--bg-base)]">
				<div className="flex flex-col items-center gap-3">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-3 animate-pulse rounded bg-[var(--bg-elevated)]"
							style={{ width: `${180 - i * 30}px` }}
						/>
					))}
					<div className="mt-2 text-[11px] text-[var(--text-quaternary)]">
						Loading PR details...
					</div>
				</div>
			</div>
		);
	}

	const statusMessage = isSolving
		? "Reviewing..."
		: isCancelled
			? "Cancelled"
			: pendingCount > 0
				? `${pendingCount} comments pending review`
				: "All comments reviewed";

	return (
		<div className="flex flex-col h-full overflow-hidden">
			<div ref={scrollRef} className="flex-1 overflow-y-auto bg-[var(--bg-base)]">
				<div className="mx-auto max-w-[800px] pb-10">
					{/* PR Header — always shown */}
					<PRHeader details={details} prCtx={prCtx} />

					{/* Status Strip — review mode only */}
					{hasActiveDraft && (
						<StatusStrip
							approvedCount={approvedCount}
							rejectedCount={rejectedCount}
							pendingCount={pendingCount}
							approvalPct={approvalPct}
							roundNumber={aiDraftQuery.data?.roundNumber ?? 1}
							aiSuggestion={aiSuggestion}
							isSolving={isSolving}
							onCancel={() => cancelMutation.mutate({ draftId })}
						/>
					)}

					{/* AI Summary — always shown when available */}
					{summaryMarkdown && <AISummaryCard summaryMarkdown={summaryMarkdown} />}

					{/* Review mode: grouped-by-file cards */}
					{hasActiveDraft && groupedByFile && (
						<div className="mx-6 mt-5">
							<div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)] mb-2">
								{groupedByFile.length} Files
							</div>
							{groupedByFile.map(([filePath, fileItems]) => (
								<ReviewFileGroupCard
									key={filePath}
									filePath={filePath}
									items={fileItems}
									defaultExpanded={filePath === firstPendingFile}
									onApprove={(commentId) => updateComment.mutate({ commentId, status: "approved" })}
									onReject={(commentId) => updateComment.mutate({ commentId, status: "rejected" })}
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
									onOpenInDiff={(path) => {
										if (!activeWorkspaceId) return;
										selectFile(sessionKey, path);
										useTabStore
											.getState()
											.swapPRReviewFile(activeWorkspaceId, prCtx, path, detectLanguage(path));
									}}
									onReplyToThread={(threadId, body) => addReplyComment.mutate({ threadId, body })}
									onResolveThread={(threadId) => resolveThread.mutate({ threadId })}
								/>
							))}
						</div>
					)}

					{/* Read-only mode: flat comments feed */}
					{!hasActiveDraft && (
						<CommentsFeed details={details} prCtx={prCtx} aiThreads={aiThreads} />
					)}

					{/* Chain History — review mode only */}
					{hasActiveDraft && chainHistory && chainHistory.length > 1 && (
						<div className="mx-6 mt-5">
							<button
								type="button"
								onClick={() => setHistoryExpanded(!historyExpanded)}
								className="flex items-center gap-[6px] cursor-pointer select-none mb-[6px] bg-transparent border-none p-0"
							>
								<span
									className="text-[10px] text-[var(--text-tertiary)] w-[14px] text-center transition-transform duration-[150ms]"
									style={{
										transform: historyExpanded ? "rotate(90deg)" : "none",
									}}
								>
									&rsaquo;
								</span>
								<span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
									Review History &middot; {chainHistory.length} rounds
								</span>
							</button>
							{historyExpanded && (
								<div className="bg-[var(--bg-elevated)] rounded-[6px] p-[10px_14px]">
									{chainHistory.map((entry) => (
										<div
											key={entry.id}
											className="text-[11px] text-[var(--text-secondary)] py-[3px]"
										>
											Round {entry.roundNumber} &middot;{" "}
											{new Date(entry.createdAt).toLocaleDateString("en-US", {
												month: "short",
												day: "numeric",
											})}{" "}
											&middot; {entry.commentCount} comments &middot;{" "}
											<span className="capitalize">{entry.status}</span>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			</div>

			{/* Bottom Bar — review mode only */}
			{hasActiveDraft && (
				<ReviewBottomBar
					statusMessage={statusMessage}
					isSolving={isSolving}
					showVerdictConfirmation={showVerdictConfirmation}
					isSubmitting={submitReview.isPending}
					onDismiss={() => dismissPending.mutate({ draftId })}
					onShowVerdict={() => setShowVerdictConfirmation(true)}
					onCancelVerdict={() => setShowVerdictConfirmation(false)}
					onSubmitVerdict={(verdict, body) => submitReview.mutate({ draftId, verdict, body })}
				/>
			)}
		</div>
	);
}
