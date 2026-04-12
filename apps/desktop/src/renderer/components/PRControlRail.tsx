import { useMemo, useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type {
	AIDraftThread,
	GitHubPRDetails,
	PRContext,
	UnifiedThread,
} from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CommentThreadCard, threadAuthor, threadDate } from "./CommentThreadCard";
import type { SortMode } from "./CommentThreadCard";
import { RepoFileTree } from "./RepoFileTree";
import { SmartHeaderBar } from "./SmartHeaderBar";
import { SubmitReviewModal } from "./SubmitReviewModal";
import { Tooltip } from "./Tooltip";
import { changesIcon, commentsIcon, filesIcon, sparkleIcon } from "./panel-icons";

type PRTab = "changes" | "comments" | "files";

const prTabIcons: Record<PRTab, React.ReactNode> = {
	changes: changesIcon,
	comments: commentsIcon,
	files: filesIcon,
};

// ── Tab header (segmented control) ──────────────────────────────────────────

function PRTabHeader({
	tab,
	onSetTab,
	commentCount,
	onClose,
	reviewButton,
}: {
	tab: PRTab;
	onSetTab: (t: PRTab) => void;
	commentCount: number;
	onClose?: () => void;
	reviewButton?: React.ReactNode;
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
					<Tooltip key={t.key} label={t.label}>
						<button
							type="button"
							onClick={() => onSetTab(t.key)}
							className={[
								"flex items-center gap-1 rounded-[4px] px-2 py-1 transition-all duration-[120ms]",
								tab === t.key
									? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
							].join(" ")}
						>
							{prTabIcons[t.key]}
							{t.badge != null && (
								<span className="rounded-full bg-[var(--bg-overlay)] px-1 text-[9px] text-[var(--text-tertiary)]">
									{t.badge}
								</span>
							)}
						</button>
					</Tooltip>
				))}
			</div>
			<div className="flex-1" />
			{reviewButton}
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
	prCtx: PRContext;
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

	// Commits query — use origin/<baseBranch> because worktrees may not have
	// a local tracking branch for the target (e.g. no local "main", only "origin/main")
	const commitsBaseBranch = baseBranch.startsWith("origin/") ? baseBranch : `origin/${baseBranch}`;
	const commitsQuery = trpc.diff.getCommitsAhead.useQuery(
		{ repoPath: prCtx.repoPath, baseBranch: commitsBaseBranch },
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
	prCtx: PRContext;
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

function CommentsTab({
	details,
	prCtx,
	aiThreads,
	summaryMarkdown,
	onShowSummary,
	hasActiveDraft,
}: {
	details: GitHubPRDetails;
	prCtx: PRContext;
	aiThreads: AIDraftThread[];
	summaryMarkdown: string | null;
	onShowSummary: () => void;
	hasActiveDraft: boolean;
}) {
	const [sortMode, setSortMode] = useState<SortMode>("by-file");
	const utils = trpc.useUtils();
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	const invalidateDrafts = () => {
		utils.aiReview.getReviewDrafts.invalidate();
		utils.aiReview.getReviewDraft.invalidate();
	};

	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: invalidateDrafts,
	});

	const deleteDraftComment = trpc.aiReview.deleteDraftComment.useMutation({
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
			onDelete={(id) => deleteDraftComment.mutate({ commentId: id })}
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
			{/* Toolbar */}
			<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
				{summaryMarkdown && (
					<Tooltip label="Summary">
						<button
							type="button"
							onClick={onShowSummary}
							className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-quaternary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
						>
							{sparkleIcon}
						</button>
					</Tooltip>
				)}
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

			{/* Review-in-progress banner */}
			{hasActiveDraft && (
				<button
					type="button"
					onClick={() => {
						const tabStore = useTabStore.getState();
						const tabs = tabStore.getVisibleTabs();
						const reviewTab = tabs.find((t) => t.kind === "pr-overview");
						if (reviewTab) tabStore.setActiveTab(reviewTab.id);
					}}
					className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-elevated)]"
				>
					<span className="size-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
					<span className="flex-1 text-[10px] text-[var(--text-tertiary)]">
						AI review in progress
					</span>
					<span className="text-[10px] text-[var(--accent)]">Open Review Tab</span>
				</button>
			)}

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

export function PRControlRail({ prCtx }: { prCtx: PRContext }) {
	const [tab, setTab] = useState<PRTab>("files");
	const [showSubmitModal, setShowSubmitModal] = useState(false);
	const utils = trpc.useUtils();
	const closeDiffPanel = useTabStore((s) => s.closeDiffPanel);

	// ── PR details ────────────────────────────────────────────────────────
	const { data: details, isLoading } = trpc.projects.getPRDetails.useQuery(
		{ provider: prCtx.provider, owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
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
		{ enabled: !!matchingDraft?.id, refetchInterval: 5_000 }
	);

	const draftRoundNumber = aiDraftQuery.data?.roundNumber ?? 1;
	const draftReviewChainId = aiDraftQuery.data?.reviewChainId ?? matchingDraft?.id ?? null;

	// ── Unified review button mutations ───────────────────────────────────
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const triggerReview = trpc.aiReview.triggerReview.useMutation({
		onSuccess: (launchInfo) => {
			utils.aiReview.getReviewDrafts.invalidate();
			utils.aiReview.getReviewDraft.invalidate();
			if (!launchInfo.reviewWorkspaceId || !launchInfo.worktreePath) return;
			const tabStore = useTabStore.getState();
			const tabId = tabStore.addTerminalTab(
				launchInfo.reviewWorkspaceId,
				launchInfo.worktreePath,
				"AI Review"
			);
			attachTerminal.mutate({
				workspaceId: launchInfo.reviewWorkspaceId,
				terminalId: tabId,
			});
			setTimeout(() => {
				window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\n`);
			}, 500);
		},
	});

	const cancelReview = trpc.aiReview.cancelReview.useMutation({
		onSuccess: () => {
			utils.aiReview.getReviewDrafts.invalidate();
			utils.aiReview.getReviewDraft.invalidate();
		},
	});

	const triggerFollowUp = trpc.aiReview.triggerFollowUp.useMutation({
		onSuccess: (launchInfo) => {
			utils.aiReview.getReviewDrafts.invalidate();
			utils.aiReview.getReviewDraft.invalidate();
			if (!launchInfo.reviewWorkspaceId || !launchInfo.worktreePath) return;
			const tabStore = useTabStore.getState();
			const tabId = tabStore.addTerminalTab(
				launchInfo.reviewWorkspaceId,
				launchInfo.worktreePath,
				"AI Re-review"
			);
			attachTerminal.mutate({
				workspaceId: launchInfo.reviewWorkspaceId,
				terminalId: tabId,
			});
			setTimeout(() => {
				window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\n`);
			}, 500);
		},
	});

	// ── Unified button state ──────────────────────────────────────────────
	const draftStatus = matchingDraft?.status ?? null;
	const isReviewActive = draftStatus === "queued" || draftStatus === "in_progress";
	const hasExistingReview = !!matchingDraft;

	const reviewButtonLabel = !hasExistingReview
		? "Start Review"
		: isReviewActive
			? "Restart Review"
			: "Re-review";

	const reviewButtonPending =
		triggerReview.isPending || cancelReview.isPending || triggerFollowUp.isPending;

	const projectsQuery = trpc.projects.getByRepo.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo },
		{ staleTime: 60_000 }
	);

	const handleUnifiedReview = async () => {
		if (isReviewActive && matchingDraft) {
			await cancelReview.mutateAsync({ draftId: matchingDraft.id });
			// After cancel, always start a fresh review
			const project = projectsQuery.data?.[0];
			if (!project) {
				console.error("[ai-review] Cannot restart: project not found for", prIdentifier);
				return;
			}
			triggerReview.mutate({
				provider: prCtx.provider,
				identifier: prIdentifier,
				title: prCtx.title,
				author: "",
				sourceBranch: prCtx.sourceBranch,
				targetBranch: prCtx.targetBranch,
				repoPath: project.repoPath,
				projectId: project.id,
			});
			return;
		}

		if (hasExistingReview && draftReviewChainId) {
			triggerFollowUp.mutate({ reviewChainId: draftReviewChainId });
		} else {
			const project = projectsQuery.data?.[0];
			if (!project) {
				console.error("[ai-review] Cannot start review: project not found for", prIdentifier);
				return;
			}
			triggerReview.mutate({
				provider: prCtx.provider,
				identifier: prIdentifier,
				title: prCtx.title,
				author: "",
				sourceBranch: prCtx.sourceBranch,
				targetBranch: prCtx.targetBranch,
				repoPath: project.repoPath,
				projectId: project.id,
			});
		}
	};

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
		.filter((c) => c.status === "pending" || c.status === "edited" || c.status === "error")
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
				reviewButton={
					<Tooltip label={reviewButtonLabel}>
						<button
							type="button"
							onClick={handleUnifiedReview}
							disabled={reviewButtonPending}
							className={[
								"flex h-6 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 transition-colors",
								reviewButtonPending
									? "text-[var(--text-quaternary)]"
									: "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]",
							].join(" ")}
						>
							<svg
								width="13"
								height="13"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M2 8a6 6 0 0 1 10.3-4.2M14 8a6 6 0 0 1-10.3 4.2" />
								<path d="M14 2v4h-4M2 14v-4h4" />
							</svg>
							<span className="text-[10px] font-medium">
								{reviewButtonPending ? "Starting..." : reviewButtonLabel}
							</span>
						</button>
					</Tooltip>
				}
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
					hasActiveDraft={
						!!matchingDraft &&
						matchingDraft.status !== "dismissed" &&
						matchingDraft.status !== "submitted"
					}
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
						utils.projects.getPRDetails.invalidate({
							provider: prCtx.provider,
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
