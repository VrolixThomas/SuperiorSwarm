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
import { RepoFileTree } from "./RepoFileTree";
import { SmartHeaderBar } from "./SmartHeaderBar";
import { SubmitReviewModal } from "./SubmitReviewModal";

type PRTab = "changes" | "comments" | "files";
type SortMode = "by-file" | "by-reviewer" | "latest-first";

// ── Tab header (segmented control) ──────────────────────────────────────────

function PRTabHeader({
	tab,
	onSetTab,
	commentCount,
	onClose,
}: {
	tab: PRTab;
	onSetTab: (t: PRTab) => void;
	commentCount: number;
	onClose?: () => void;
}) {
	const tabs: { key: PRTab; label: string; badge?: number }[] = [
		{ key: "changes", label: "Changes" },
		{ key: "comments", label: "Comments", badge: commentCount > 0 ? commentCount : undefined },
		{ key: "files", label: "Files" },
	];

	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
			<div className="flex rounded-[var(--radius-sm)] bg-[var(--bg-base)] p-0.5">
				{tabs.map((t) => (
					<button
						key={t.key}
						type="button"
						onClick={() => onSetTab(t.key)}
						className={[
							"flex items-center gap-1 rounded-[4px] px-3 py-0.5 text-[11px] font-medium transition-all duration-[120ms]",
							tab === t.key
								? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
								: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
						].join(" ")}
					>
						{t.label}
						{t.badge != null && (
							<span className="rounded-full bg-[var(--bg-overlay)] px-1 text-[9px] text-[var(--text-tertiary)]">
								{t.badge}
							</span>
						)}
					</button>
				))}
			</div>
			<div className="flex-1" />
			{onClose && (
				<button
					type="button"
					onClick={onClose}
					className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
					title="Close panel"
				>
					<svg
						width="10"
						height="10"
						viewBox="0 0 10 10"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M1 1l8 8M9 1l-8 8" />
					</svg>
				</button>
			)}
		</div>
	);
}

// ── Changes tab ─────────────────────────────────────────────────────────────

const CHANGE_TYPE_DOT: Record<string, string> = {
	ADDED: "bg-[var(--term-green)]",
	MODIFIED: "bg-[var(--term-yellow)]",
	DELETED: "bg-[var(--term-red)]",
	RENAMED: "bg-[var(--accent)]",
	COPIED: "bg-[var(--accent)]",
	CHANGED: "bg-[var(--term-yellow)]",
	UNCHANGED: "bg-[var(--text-quaternary)]",
};

function ChangesTab({
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
	const [collapsed, setCollapsed] = useState(false);
	const [baseBranch, setBaseBranch] = useState(prCtx.targetBranch);

	const isCustomBase = baseBranch !== prCtx.targetBranch;

	// When comparing to a custom base, fetch the diff dynamically
	const branchDiffQuery = trpc.diff.getBranchDiff.useQuery(
		{ repoPath: prCtx.repoPath, baseBranch, headBranch: prCtx.sourceBranch },
		{ staleTime: 30_000, enabled: isCustomBase && !!prCtx.repoPath }
	);

	// Use PR files for default base, dynamic diff for custom base
	const files = isCustomBase
		? (branchDiffQuery.data?.files ?? []).map((f) => ({
				path: f.path,
				additions: f.additions,
				deletions: f.deletions,
				changeType:
					f.status === "added"
						? "ADDED"
						: f.status === "deleted"
							? "DELETED"
							: f.status === "renamed"
								? "RENAMED"
								: "MODIFIED",
			}))
		: details.files.map((f) => ({
				path: f.path,
				additions: f.additions,
				deletions: f.deletions,
				changeType: f.changeType,
			}));

	const totalAdditions = useMemo(() => files.reduce((s, f) => s + f.additions, 0), [files]);
	const totalDeletions = useMemo(() => files.reduce((s, f) => s + f.deletions, 0), [files]);

	// Commits query
	const commitsQuery = trpc.diff.getCommitsAhead.useQuery(
		{ repoPath: prCtx.repoPath, baseBranch },
		{ staleTime: 30_000, enabled: !!prCtx.repoPath }
	);
	const commits = commitsQuery.data ?? [];

	const viewed = viewedFiles.size;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* Branch comparison header */}
			{prCtx.repoPath && (
				<SmartHeaderBar
					repoPath={prCtx.repoPath}
					currentBranch={prCtx.sourceBranch}
					baseBranch={baseBranch}
					onBaseBranchChange={setBaseBranch}
				/>
			)}

			<div className="flex-1 overflow-y-auto">
				{/* Loading state for custom base */}
				{isCustomBase && branchDiffQuery.isLoading && (
					<div className="px-3 py-4 text-[12px] text-[var(--text-quaternary)]">Loading diff…</div>
				)}

				{/* Branch changes card with integrated review progress */}
				{(!isCustomBase || !branchDiffQuery.isLoading) && (
					<div className="mx-1.5 mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)]">
						<button
							type="button"
							onClick={() => setCollapsed((c) => !c)}
							className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)]"
						>
							<span
								className="text-[10px] text-[var(--text-quaternary)] transition-transform duration-150"
								style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
							>
								▾
							</span>
							<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
								Branch Changes
							</span>
							<span className="rounded-full bg-[var(--bg-overlay)] px-1.5 py-px text-[10px] text-[var(--text-tertiary)]">
								{files.length} {files.length === 1 ? "file" : "files"}
							</span>
							<div className="flex-1" />
							<span className="text-[11px]">
								<span className="text-[var(--term-green)]">+{totalAdditions}</span>
								<span className="mx-1 text-[var(--text-quaternary)]">/</span>
								<span className="text-[var(--term-red)]">-{totalDeletions}</span>
							</span>
						</button>

						{/* Review progress bar */}
						{!collapsed && files.length > 0 && (
							<div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-1.5">
								<div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
									<div
										className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
										style={{
											width: files.length > 0 ? `${(viewed / files.length) * 100}%` : "0%",
										}}
									/>
								</div>
								<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
									{viewed}/{files.length}
								</span>
							</div>
						)}

						{!collapsed && (
							<div className="border-t border-[var(--border-subtle)] py-0.5">
								{files.length === 0 && (
									<div className="px-2 py-2 text-[12px] text-[var(--text-quaternary)]">
										No changes vs <span className="font-medium">{baseBranch}</span>
									</div>
								)}
								{files.map((file) => {
									const filename = file.path.split("/").pop() ?? file.path;
									const isViewed = viewedFiles.has(file.path);
									const commentCount = commentCountByFile.get(file.path) ?? 0;
									const isActive = file.path === activeFilePath;
									return (
										<div
											key={file.path}
											className={[
												"flex items-center gap-1.5 px-2 py-[3px]",
												isActive
													? "border-l-2 border-l-[var(--accent)] bg-[var(--bg-overlay)]"
													: "",
											].join(" ")}
										>
											{/* Reviewed toggle */}
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

											{/* Status dot */}
											<span
												className={`size-1.5 shrink-0 rounded-full ${CHANGE_TYPE_DOT[file.changeType] ?? "bg-[var(--text-quaternary)]"}`}
											/>

											{/* File name */}
											<button
												type="button"
												onClick={() => {
													if (!activeWorkspaceId) return;
													openPRReviewFile(
														activeWorkspaceId,
														prCtx,
														file.path,
														detectLanguage(file.path)
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

											{/* Comment badge */}
											{commentCount > 0 && (
												<span className="shrink-0 rounded-full bg-[var(--bg-overlay)] px-1.5 text-[10px] font-medium text-yellow-400">
													{commentCount}
												</span>
											)}

											{/* +/- stats */}
											<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
												{file.additions > 0 && (
													<span className="text-[var(--term-green)]">+{file.additions}</span>
												)}
												{file.deletions > 0 && (
													<span className="ml-0.5 text-[var(--term-red)]">-{file.deletions}</span>
												)}
											</span>
										</div>
									);
								})}
							</div>
						)}
					</div>
				)}

				{/* Commits section */}
				<div className="mt-3 flex flex-col gap-1 pb-4">
					<div className="flex items-center gap-2 px-3 py-1.5">
						<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
							Commits
						</span>
						{commits.length > 0 && (
							<span className="rounded-full bg-[var(--bg-overlay)] px-1.5 py-px text-[10px] text-[var(--text-tertiary)]">
								{commits.length}
							</span>
						)}
					</div>
					{commitsQuery.isLoading && (
						<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">Loading...</div>
					)}
					{!commitsQuery.isLoading && commits.length === 0 && (
						<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
							No commits ahead of <span className="font-medium">{baseBranch}</span>
						</div>
					)}
					{commits.map((commit) => (
						<PRCommitCard key={commit.hash} commit={commit} prCtx={prCtx} />
					))}
				</div>
			</div>
		</div>
	);
}

const COMMIT_STATUS_DOT: Record<string, string> = {
	added: "bg-[var(--term-green)]",
	modified: "bg-[var(--term-yellow)]",
	deleted: "bg-[var(--term-red)]",
	renamed: "bg-[var(--accent)]",
	binary: "bg-[var(--text-quaternary)]",
};

function PRCommitCard({
	commit,
	prCtx,
}: {
	commit: {
		hash: string;
		shortHash: string;
		message: string;
		time: string;
		additions: number;
		deletions: number;
		files: { path: string; status: string; additions: number; deletions: number }[];
	};
	prCtx: GitHubPRContext;
}) {
	const [expanded, setExpanded] = useState(false);
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	return (
		<div className="mx-1.5 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
			<button
				type="button"
				onClick={() => setExpanded((e) => !e)}
				className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]"
			>
				<div className="flex w-full items-center gap-2">
					<span
						className="shrink-0 text-[11px] text-[var(--text-quaternary)]"
						style={{ fontFamily: "var(--font-mono)" }}
					>
						{commit.shortHash}
					</span>
					<span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
						{commit.message}
					</span>
					<span className="shrink-0 text-[11px] text-[var(--text-quaternary)]">{commit.time}</span>
				</div>
				<div className="flex w-full items-center gap-2">
					<span className="text-[11px]">
						{commit.additions > 0 && (
							<span className="text-[var(--term-green)]">+{commit.additions}</span>
						)}
						{commit.deletions > 0 && (
							<span className="ml-1 text-[var(--term-red)]">-{commit.deletions}</span>
						)}
					</span>
					<span className="text-[11px] text-[var(--text-quaternary)]">
						· {commit.files.length} file{commit.files.length !== 1 ? "s" : ""}
					</span>
					<div className="flex-1" />
					<span
						className="text-[10px] text-[var(--text-quaternary)] transition-transform duration-150"
						style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
					>
						▾
					</span>
				</div>
			</button>
			{expanded && (
				<div className="border-t border-[var(--border-subtle)] px-1 py-1">
					{commit.files.map((file) => {
						const fileName = file.path.split("/").pop() ?? file.path;
						return (
							<button
								key={file.path}
								type="button"
								onClick={() => {
									if (!activeWorkspaceId) return;
									openPRReviewFile(activeWorkspaceId, prCtx, file.path, detectLanguage(file.path));
								}}
								className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] text-[var(--text-secondary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]"
							>
								<span
									className={`size-1.5 shrink-0 rounded-full ${COMMIT_STATUS_DOT[file.status] ?? "bg-[var(--text-quaternary)]"}`}
								/>
								<span className="min-w-0 flex-1 truncate">{fileName}</span>
								<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
									{file.additions > 0 && (
										<span className="text-[var(--term-green)]">+{file.additions}</span>
									)}
									{file.deletions > 0 && (
										<span className="ml-0.5 text-[var(--term-red)]">-{file.deletions}</span>
									)}
								</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

// ── Comments tab ────────────────────────────────────────────────────────────

function threadAuthor(t: UnifiedThread): string {
	if (t.isAIDraft) return "BranchFlux AI";
	return (t as GitHubReviewThread).comments[0]?.author ?? "Unknown";
}

function threadDate(t: UnifiedThread): string {
	if (t.isAIDraft) return t.createdAt;
	return (t as GitHubReviewThread).comments[0]?.createdAt ?? "";
}

function CommentsTab({
	details,
	prCtx,
	aiThreads,
	summaryMarkdown,
	onShowSummary,
	reviewChainId,
}: {
	details: GitHubPRDetails;
	prCtx: GitHubPRContext;
	aiThreads: AIDraftThread[];
	summaryMarkdown: string | null;
	onShowSummary: () => void;
	reviewChainId: string | null;
}) {
	const [sortMode, setSortMode] = useState<SortMode>("by-file");
	const utils = trpc.useUtils();
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const attachTerminal = trpc.reviewWorkspaces.attachTerminal.useMutation();
	const triggerFollowUp = trpc.aiReview.triggerFollowUp.useMutation({
		onSuccess: (launchInfo) => {
			utils.aiReview.getReviewDrafts.invalidate();
			utils.aiReview.getReviewDraft.invalidate();

			if (!launchInfo.reviewWorkspaceId || !launchInfo.worktreePath) return;

			const tabStore = useTabStore.getState();

			// Create terminal and run the launch script
			const tabId = tabStore.addTerminalTab(
				launchInfo.reviewWorkspaceId,
				launchInfo.worktreePath,
				"AI Re-review"
			);
			attachTerminal.mutate({
				reviewWorkspaceId: launchInfo.reviewWorkspaceId,
				terminalId: tabId,
			});

			setTimeout(() => {
				window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\n`);
			}, 500);
		},
		onError: (err) => {
			console.error("[ai-review] Follow-up review failed:", err);
		},
	});

	const invalidateDrafts = () => {
		utils.aiReview.getReviewDrafts.invalidate();
		utils.aiReview.getReviewDraft.invalidate();
	};

	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: invalidateDrafts,
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

	const allThreads: UnifiedThread[] = useMemo(() => {
		const ghThreads: UnifiedThread[] = details.reviewThreads.map((t) => ({
			...t,
			isAIDraft: false as const,
		}));
		return [...ghThreads, ...aiThreads];
	}, [details.reviewThreads, aiThreads]);

	const grouped = useMemo(() => {
		if (sortMode === "latest-first") return null;
		const map = new Map<string, UnifiedThread[]>();
		for (const t of allThreads) {
			const key = sortMode === "by-file" ? t.path : threadAuthor(t);
			const list = map.get(key);
			if (list) list.push(t);
			else map.set(key, [t]);
		}
		return map;
	}, [allThreads, sortMode]);

	const flatSorted = useMemo(() => {
		if (sortMode !== "latest-first") return null;
		return [...allThreads].sort(
			(a, b) => new Date(threadDate(b)).getTime() - new Date(threadDate(a)).getTime()
		);
	}, [allThreads, sortMode]);

	if (allThreads.length === 0 && !summaryMarkdown) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<span className="text-[12px] text-[var(--text-quaternary)]">No comments yet</span>
			</div>
		);
	}

	const renderThread = (t: UnifiedThread) => (
		<CommentThreadCard
			key={t.id}
			thread={t}
			prCtx={prCtx}
			onAccept={(id) => updateDraftComment.mutate({ commentId: id, status: "user-pending" })}
			onDecline={(id) => updateDraftComment.mutate({ commentId: id, status: "rejected" })}
			onReply={(threadId, body) => addComment.mutate({ threadId, body })}
			onResolve={(threadId) => resolveThread.mutate({ threadId })}
			onNavigate={(path) => {
				if (!activeWorkspaceId) return;
				openPRReviewFile(activeWorkspaceId, prCtx, path, detectLanguage(path));
			}}
		/>
	);

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* Sort control */}
			<div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5">
				<span className="text-[11px] text-[var(--text-tertiary)]">
					{allThreads.length} thread{allThreads.length !== 1 ? "s" : ""}
				</span>
				<div className="flex items-center gap-1.5">
					{reviewChainId && (
						<button
							type="button"
							onClick={() => triggerFollowUp.mutate({ reviewChainId })}
							disabled={triggerFollowUp.isPending}
							className={`flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-[12px] transition-colors ${
								triggerFollowUp.isError
									? "border-[#f85149] text-[#f85149]"
									: "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)]"
							}`}
						>
							{triggerFollowUp.isPending
								? "Starting..."
								: triggerFollowUp.isError
									? "Failed"
									: "Re-review"}
						</button>
					)}
					{summaryMarkdown && (
						<button
							type="button"
							onClick={onShowSummary}
							className="flex items-center gap-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)] outline-none transition-colors hover:text-[var(--text-secondary)]"
						>
							✦ Summary
						</button>
					)}
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
			</div>

			{/* Thread list */}
			<div className="flex-1 overflow-y-auto py-1">
				{sortMode === "latest-first" && flatSorted
					? flatSorted.map(renderThread)
					: grouped &&
						Array.from(grouped.entries()).map(([key, threads]) => (
							<div key={key}>
								<div className="px-3 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
									{key}
								</div>
								{threads.map(renderThread)}
							</div>
						))}
			</div>
		</div>
	);
}

function CommentThreadCard({
	thread,
	prCtx,
	onAccept,
	onDecline,
	onReply,
	onResolve,
	onNavigate,
}: {
	thread: UnifiedThread;
	prCtx: GitHubPRContext;
	onAccept?: (id: string) => void;
	onDecline?: (id: string) => void;
	onReply?: (threadId: string, body: string) => void;
	onResolve?: (threadId: string) => void;
	onNavigate: (path: string) => void;
}) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyBody, setReplyBody] = useState("");
	const replyRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (replyOpen) replyRef.current?.focus();
	}, [replyOpen]);

	const filename = thread.path.split("/").pop() ?? thread.path;
	const isAI = !!thread.isAIDraft;

	if (isAI) {
		const ai = thread as AIDraftThread;
		return (
			<div className="mx-2 mb-1.5 overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
				<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1">
					<span className="ai-badge">AI</span>
					<button
						type="button"
						onClick={() => onNavigate(thread.path)}
						className="font-mono text-[10px] text-[var(--text-quaternary)] hover:text-[var(--accent)]"
					>
						{filename}
						{ai.line != null && `:${ai.line}`}
					</button>
					<div className="flex-1" />
					{ai.roundNumber != null && ai.roundNumber > 1 && (
						<span className="text-[10px] text-[var(--text-quaternary)]">
							Round {ai.roundNumber}
						</span>
					)}
					{ai.resolution === "resolved-by-code" && (
						<span className="flex items-center gap-1 text-[11px] text-[#32d74b]">
							<span>&#10003;</span> Resolved
						</span>
					)}
					{ai.resolution === "incorrectly-resolved" && (
						<span className="flex items-center gap-1 text-[11px] text-[#ff9f0a]">
							<span>&#9888;</span> Flagged
						</span>
					)}
					{ai.status === "user-pending" && (
						<span className="rounded-[3px] border border-[var(--border-active)] bg-[var(--bg-overlay)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
							Pending
						</span>
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
			<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1">
				<button
					type="button"
					onClick={() => onNavigate(thread.path)}
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
					<p className="text-[11px] text-[var(--text-tertiary)] whitespace-pre-wrap">{c.body}</p>
				</div>
			))}

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

// ── Files tab ───────────────────────────────────────────────────────────────

// ── Bottom bar ──────────────────────────────────────────────────────────────

function AISuggestionsBadge({ count, onClick }: { count: number; onClick: () => void }) {
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

function SubmitReviewButton({
	pendingUserCount,
	onClick,
}: {
	pendingUserCount: number;
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
				{pendingUserCount > 0 && (
					<span className="rounded-full bg-green-400/20 px-1.5 text-[10px]">
						{pendingUserCount}
					</span>
				)}
			</button>
		</div>
	);
}

// ── Root: PRControlRail ─────────────────────────────────────────────────────

export function PRControlRail({ prCtx }: { prCtx: GitHubPRContext }) {
	const [tab, setTab] = useState<PRTab>("files");
	const [showSubmitModal, setShowSubmitModal] = useState(false);
	const utils = trpc.useUtils();
	const closeDiffPanel = useTabStore((s) => s.closeDiffPanel);

	// ── PR details ────────────────────────────────────────────────────────
	const { data: details, isLoading } = trpc.github.getPRDetails.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);

	// ── Viewed files ──────────────────────────────────────────────────────
	const { data: viewedFilesList } = trpc.github.getViewedFiles.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
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
	// Find the latest actionable draft for this PR: prefer ready > in_progress > queued, then highest round
	const matchingDraft = (() => {
		const drafts = reviewDraftsQuery.data?.filter((d) => d.prIdentifier === prIdentifier) ?? [];
		if (drafts.length === 0) return undefined;
		const statusPriority: Record<string, number> = { ready: 0, "in_progress": 1, queued: 2, submitted: 3, failed: 4 };
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

	const draftRoundNumber = aiDraftQuery.data?.roundNumber ?? 1;
	const draftReviewChainId = aiDraftQuery.data?.reviewChainId ?? matchingDraft?.id ?? null;

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
		roundNumber: draftRoundNumber,
	});

	const aiThreads: AIDraftThread[] = (aiDraftQuery.data?.comments ?? [])
		.filter((c) => c.status === "pending" || c.status === "edited")
		.map(mapComment);

	// User-pending = accepted AI comments + user-authored drafts — all published on submit
	const userPendingThreads: AIDraftThread[] = (aiDraftQuery.data?.comments ?? [])
		.filter((c) => c.status === "user-pending")
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
	for (const t of [...aiThreads, ...userPendingThreads]) {
		commentCountByFile.set(t.path, (commentCountByFile.get(t.path) ?? 0) + 1);
	}

	const totalComments =
		(details?.reviewThreads.length ?? 0) + aiThreads.length + userPendingThreads.length;

	// ── Active file detection ─────────────────────────────────────────────
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const openPROverview = useTabStore((s) => s.openPROverview);
	const activeFilePath = useTabStore((s) => {
		const wsId = s.activeWorkspaceId;
		if (!wsId) return null;
		const tabs = s.getVisibleTabs();
		const activeId = s.getActiveTabId();
		const t = tabs.find((x) => x.id === activeId);
		return t?.kind === "pr-review-file" ? t.filePath : null;
	});

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
	const pendingUserCount = userPendingThreads.length;

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<PRTabHeader
				tab={tab}
				onSetTab={setTab}
				commentCount={totalComments}
				onClose={closeDiffPanel}
			/>

			{/* Tab content */}
			{tab === "changes" && (
				<ChangesTab
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
			)}
			{tab === "comments" && (
				<CommentsTab
					details={details}
					prCtx={prCtx}
					aiThreads={[...aiThreads, ...userPendingThreads]}
					summaryMarkdown={aiDraftQuery.data?.summaryMarkdown ?? null}
					onShowSummary={() => activeWorkspaceId && openPROverview(activeWorkspaceId, prCtx)}
					reviewChainId={draftReviewChainId}
				/>
			)}
			{tab === "files" && prCtx.repoPath && activeWorkspaceId && (
				<RepoFileTree repoPath={prCtx.repoPath} workspaceId={activeWorkspaceId} />
			)}

			{/* Pinned bottom bar */}
			<AISuggestionsBadge
				count={pendingCount}
				onClick={() => {
					if (activeWorkspaceId) {
						openPROverview(activeWorkspaceId, prCtx);
					}
				}}
			/>

			<SubmitReviewButton
				pendingUserCount={pendingUserCount}
				onClick={() => setShowSubmitModal(true)}
			/>

			{showSubmitModal && (
				<SubmitReviewModal
					prCtx={prCtx}
					aiThreads={userPendingThreads}
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
						utils.github.getMyPRs.invalidate();
						aiDraftQuery.refetch();
					}}
				/>
			)}
		</div>
	);
}
