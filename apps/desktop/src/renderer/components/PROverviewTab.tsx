import { useEffect, useMemo, useRef, useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type {
	AIDraftThread,
	GitHubPRDetails,
	GitHubReviewThread,
	PRContext,
	UnifiedThread,
} from "../../shared/github-types";
import { formatRelativeTime } from "../../shared/tickets";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { MarkdownRenderer } from "./MarkdownRenderer";

// ── PRHeader ──────────────────────────────────────────────────────────────────

function PRHeader({ details, prCtx }: { details: GitHubPRDetails; prCtx: PRContext }) {
	const stateColor: Record<string, string> = {
		OPEN: "bg-green-900/40 text-[#30d158]",
		CLOSED: "bg-red-900/40 text-[#ff453a]",
		MERGED: "bg-purple-900/40 text-[#a78bfa]",
	};

	const decisionLabel: Record<string, string> = {
		APPROVED: "Approved",
		CHANGES_REQUESTED: "Changes requested",
		REVIEW_REQUIRED: "Review required",
	};

	const decisionColor: Record<string, string> = {
		APPROVED: "bg-green-900/40 text-[#30d158]",
		CHANGES_REQUESTED: "bg-red-900/40 text-[#ff453a]",
		REVIEW_REQUIRED: "bg-yellow-900/40 text-[#fbbf24]",
	};

	const reviewerDecisionIcon: Record<string, string> = {
		APPROVED: "\u2713",
		CHANGES_REQUESTED: "\u2717",
		COMMENTED: "\u25CB",
		PENDING: "\u25CB",
	};

	const reviewerDecisionColor: Record<string, string> = {
		APPROVED: "text-[#30d158]",
		CHANGES_REQUESTED: "text-[#ff453a]",
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
								? "bg-green-900/40 text-[#30d158]"
								: details.ciState === "FAILURE"
									? "bg-red-900/40 text-[#ff453a]"
									: "bg-yellow-900/40 text-[#fbbf24]"
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
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	const filename = thread.path.split("/").pop() ?? thread.path;

	const handleNavigate = () => {
		if (!activeWorkspaceId) return;
		openPRReviewFile(activeWorkspaceId, prCtx, thread.path, detectLanguage(thread.path));
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
						className="rounded-[4px] px-2.5 py-0.5 text-[10px] font-medium bg-[rgba(48,209,88,0.15)] text-[#30d158] hover:opacity-80"
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
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyBody, setReplyBody] = useState("");
	const replyRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (replyOpen) replyRef.current?.focus();
	}, [replyOpen]);

	const filename = thread.path.split("/").pop() ?? thread.path;

	const handleNavigate = () => {
		if (!activeWorkspaceId) return;
		openPRReviewFile(activeWorkspaceId, prCtx, thread.path, detectLanguage(thread.path));
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
					<span className="text-[10px] text-[#30d158]">Resolved</span>
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
									className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-white hover:opacity-80"
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
	});

	// Show AI suggestions (pending/edited) and user-pending drafts
	const aiThreads: AIDraftThread[] = (aiDraftQuery.data?.comments ?? [])
		.filter((c) => c.status === "pending" || c.status === "edited" || c.status === "user-pending")
		.map(mapComment);

	const summaryMarkdown = aiDraftQuery.data?.summaryMarkdown ?? null;

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

	return (
		<div className="h-full overflow-y-auto bg-[var(--bg-base)]">
			<div className="mx-auto max-w-[800px] pb-10">
				{/* PRHeader */}
				<PRHeader details={details} prCtx={prCtx} />

				{/* AI Summary Card */}
				{summaryMarkdown && <AISummaryCard summaryMarkdown={summaryMarkdown} />}

				{/* Unified Comments Feed */}
				<CommentsFeed details={details} prCtx={prCtx} aiThreads={aiThreads} />
			</div>
		</div>
	);
}
