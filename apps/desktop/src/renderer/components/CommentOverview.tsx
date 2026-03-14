// apps/desktop/src/renderer/components/CommentOverview.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type {
	AIDraftThread,
	GitHubPRContext,
	GitHubPRDetails,
	GitHubReviewThread,
	UnifiedThread,
} from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

type SortMode = "by-file" | "by-reviewer" | "latest-first";

function threadAuthor(t: UnifiedThread): string {
	if (t.isAIDraft) return "BranchFlux AI";
	return (t as GitHubReviewThread).comments[0]?.author ?? "Unknown";
}

function threadDate(t: UnifiedThread): string {
	if (t.isAIDraft) return t.createdAt;
	return (t as GitHubReviewThread).comments[0]?.createdAt ?? "";
}

// ── Thread card ──────────────────────────────────────────────────────────────

function ThreadCard({
	thread,
	prCtx,
	onAccept,
	onDecline,
	onReply,
	onResolve,
}: {
	thread: UnifiedThread;
	prCtx: GitHubPRContext;
	onAccept?: (id: string) => void;
	onDecline?: (id: string) => void;
	onReply?: (threadId: string, body: string) => void;
	onResolve?: (threadId: string) => void;
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
	const isAI = !!thread.isAIDraft;

	const handleNavigate = () => {
		if (!activeWorkspaceId) return;
		openPRReviewFile(activeWorkspaceId, prCtx, thread.path, detectLanguage(thread.path));
	};

	if (isAI) {
		const ai = thread as AIDraftThread;
		return (
			<div
				className="mx-2 mb-1.5 overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
				style={{ borderLeft: "2px solid #a78bfa" }}
			>
				<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1">
					<span className="ai-badge">AI</span>
					<button
						type="button"
						onClick={handleNavigate}
						className="font-mono text-[10px] text-[var(--text-quaternary)] hover:text-[var(--accent)]"
					>
						{filename}
						{ai.line != null && `:${ai.line}`}
					</button>
					<div className="flex-1" />
					{ai.status === "approved" && (
						<span className="text-[10px] text-[#30d158]">&#10003; Accepted</span>
					)}
				</div>
				<div className="px-3 py-2 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap">
					{ai.userEdit ?? ai.body}
				</div>
				{ai.status === "pending" && onAccept && onDecline && (
					<div className="flex gap-1.5 border-t border-[var(--border-subtle)] px-3 py-1.5">
						<button
							type="button"
							onClick={() => onAccept(ai.draftCommentId)}
							className="rounded-[4px] px-2 py-0.5 text-[10px] font-medium bg-[rgba(48,209,88,0.15)] text-[#30d158] hover:opacity-80"
						>
							Accept
						</button>
						<button
							type="button"
							onClick={() => onDecline(ai.draftCommentId)}
							className="rounded-[4px] px-2 py-0.5 text-[10px] bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:opacity-80"
						>
							Decline
						</button>
					</div>
				)}
			</div>
		);
	}

	// GitHub thread
	const gh = thread as GitHubReviewThread;
	return (
		<div className="mx-2 mb-1.5 overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			{/* Header */}
			<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1">
				<button
					type="button"
					onClick={handleNavigate}
					className="font-mono text-[10px] text-[var(--text-quaternary)] hover:text-[var(--accent)]"
				>
					{filename}
					{gh.line != null && `:${gh.line}`}
				</button>
				<div className="flex-1" />
				{gh.isResolved ? (
					<span className="text-[10px] text-green-400">Resolved</span>
				) : (
					onResolve && (
						<button
							type="button"
							onClick={() => onResolve(gh.id)}
							className="text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
						>
							Resolve
						</button>
					)
				)}
			</div>

			{/* Comments */}
			{gh.comments.map((c) => (
				<div
					key={c.id}
					className="border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
				>
					<div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
						<span className="font-medium text-[var(--text-secondary)]">{c.author}</span>
						<span className="text-[var(--text-quaternary)]">
							{new Date(c.createdAt).toLocaleDateString()}
						</span>
					</div>
					<p className="text-[11px] text-[var(--text-tertiary)] whitespace-pre-wrap">
						{c.body}
					</p>
				</div>
			))}

			{/* Reply */}
			{!gh.isResolved && onReply && (
				<div className="border-t border-[var(--border-subtle)]">
					{!replyOpen ? (
						<button
							type="button"
							onClick={() => setReplyOpen(true)}
							className="w-full px-3 py-1.5 text-left text-[10px] text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)] transition-colors"
						>
							Reply…
						</button>
					) : (
						<div className="flex flex-col gap-1.5 p-2">
							<textarea
								ref={replyRef}
								value={replyBody}
								onChange={(e) => setReplyBody(e.target.value)}
								rows={2}
								placeholder="Write a reply…"
								className="w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]"
							/>
							<div className="flex gap-1.5">
								<button
									type="button"
									onClick={() => {
										if (replyBody.trim()) {
											onReply(gh.id, replyBody.trim());
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

// ── Section header ───────────────────────────────────────────────────────────

function GroupHeader({ label }: { label: string }) {
	return (
		<div className="px-3 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
			{label}
		</div>
	);
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function CommentOverview({
	details,
	prCtx,
	aiThreads,
}: {
	details: GitHubPRDetails;
	prCtx: GitHubPRContext;
	aiThreads: AIDraftThread[];
}) {
	const [sortMode, setSortMode] = useState<SortMode>("by-file");
	const [collapsed, setCollapsed] = useState(false);
	const utils = trpc.useUtils();

	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: () => utils.aiReview.getReviewDraft.invalidate(),
	});

	const addComment = trpc.github.addReviewComment.useMutation({
		onSuccess: () =>
			utils.github.getPRDetails.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	const resolveThread = trpc.github.resolveThread.useMutation({
		onSuccess: () =>
			utils.github.getPRDetails.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	const handleAccept = (draftCommentId: string) => {
		updateDraftComment.mutate({ commentId: draftCommentId, status: "approved" });
	};

	const handleDecline = (draftCommentId: string) => {
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

	const totalCount = allThreads.length;

	const grouped = useMemo(() => {
		if (sortMode === "latest-first") return null;
		const map = new Map<string, UnifiedThread[]>();
		for (const t of allThreads) {
			const key = sortMode === "by-file" ? t.path : threadAuthor(t);
			const list = map.get(key);
			if (list) {
				list.push(t);
			} else {
				map.set(key, [t]);
			}
		}
		return map;
	}, [allThreads, sortMode]);

	const flatSorted = useMemo(() => {
		if (sortMode !== "latest-first") return null;
		return [...allThreads].sort(
			(a, b) => new Date(threadDate(b)).getTime() - new Date(threadDate(a)).getTime()
		);
	}, [allThreads, sortMode]);

	if (totalCount === 0) return null;

	const renderThread = (t: UnifiedThread) => (
		<ThreadCard
			key={t.id}
			thread={t}
			prCtx={prCtx}
			onAccept={handleAccept}
			onDecline={handleDecline}
			onReply={handleReply}
			onResolve={handleResolve}
		/>
	);

	return (
		<div className="border-t border-[var(--border-subtle)]">
			{/* Section header */}
			<div className="flex items-center gap-2 px-3 py-1.5">
				<button
					type="button"
					onClick={() => setCollapsed((v) => !v)}
					className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]"
				>
					<span
						className="text-[10px] text-[var(--text-quaternary)] transition-transform"
						style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
					>
						&#9660;
					</span>
					Comments ({totalCount})
				</button>

				<div className="flex-1" />

				<select
					value={sortMode}
					onChange={(e) => setSortMode(e.target.value as SortMode)}
					className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)] outline-none"
				>
					<option value="by-file">By file</option>
					<option value="by-reviewer">By reviewer</option>
					<option value="latest-first">Latest first</option>
				</select>
			</div>

			{/* Body */}
			{!collapsed && (
				<div className="max-h-[400px] overflow-y-auto pb-1">
					{sortMode === "latest-first" && flatSorted
						? flatSorted.map(renderThread)
						: grouped &&
							Array.from(grouped.entries()).map(([key, threads]) => (
								<div key={key}>
									<GroupHeader label={key} />
									{threads.map(renderThread)}
								</div>
							))}
				</div>
			)}
		</div>
	);
}
