import { useMemo, useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type { PRContext, UnifiedThread } from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CommentThreadCard, threadAuthor, threadDate } from "./CommentThreadCard";
import type { SortMode } from "./CommentThreadCard";

// ── Props ─────────────────────────────────────────────────────────────────────

interface CommentsOverviewTabProps {
	workspaceId: string;
}

// ── PR Header ─────────────────────────────────────────────────────────────────

function PRHeader({
	title,
	prNumber,
	sourceBranch,
	commentCount,
}: {
	title: string;
	prNumber: string | null;
	sourceBranch: string | null;
	commentCount: number;
}) {
	return (
		<div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
			<div className="flex items-center gap-2">
				<h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
					{title}
				</h1>
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
				{prNumber && <span className="text-[var(--text-tertiary)]">#{prNumber}</span>}
				{sourceBranch && (
					<>
						<span className="text-[var(--text-quaternary)]">&middot;</span>
						<span
							className="text-[var(--text-quaternary)]"
							style={{ fontFamily: "var(--font-mono)" }}
						>
							{sourceBranch}
						</span>
					</>
				)}
				{commentCount > 0 && (
					<>
						<span className="text-[var(--text-quaternary)]">&middot;</span>
						<span className="text-[var(--text-quaternary)]">
							{commentCount} comment{commentCount !== 1 ? "s" : ""}
						</span>
					</>
				)}
			</div>
		</div>
	);
}

// ── Solving Banner ────────────────────────────────────────────────────────────

function SolvingBanner() {
	return (
		<div className="flex items-center gap-2 border-b border-[var(--accent)] bg-[rgba(10,132,255,0.08)] px-3 py-1.5">
			<div
				className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-[var(--border-subtle)] border-t-[var(--accent)]"
				style={{ animation: "spin 0.8s linear infinite" }}
			/>
			<span className="text-[10px] text-[var(--accent)]">
				AI is solving comments — check the AI Solver terminal tab
			</span>
			<style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
		</div>
	);
}

// ── Main Component ────────────────────────────────────────────────────────────

export function CommentsOverviewTab({ workspaceId }: CommentsOverviewTabProps) {
	const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
	const [sortMode, setSortMode] = useState<SortMode>("by-file");

	const commentsQuery = trpc.commentSolver.getWorkspaceComments.useQuery(
		{ workspaceId },
		{ staleTime: 10_000 }
	);
	const sessionsQuery = trpc.commentSolver.getSolveSessions.useQuery(
		{ workspaceId },
		{ staleTime: 5_000 }
	);
	const triggerSolve = trpc.commentSolver.triggerSolve.useMutation();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const utils = trpc.useUtils();

	const meta = useTabStore((s) => s.workspaceMetadata[workspaceId]);
	const comments = commentsQuery.data ?? [];

	const prTitle = meta?.prTitle ?? "Pull Request";
	const prNumber = meta?.prIdentifier?.match(/#(\d+)$/)?.[1] ?? null;
	const sourceBranch = meta?.sourceBranch ?? null;

	// Build PRContext from workspace metadata
	const prCtx: PRContext = useMemo(() => {
		const identifier = meta?.prIdentifier ?? "";
		const [ownerRepo = "", numStr = "0"] = identifier.split("#");
		const [owner = "", repo = ""] = ownerRepo.split("/");
		return {
			provider: (meta?.prProvider ?? "github") as "github" | "bitbucket",
			owner,
			repo,
			number: parseInt(numStr, 10) || 0,
			title: meta?.prTitle ?? "",
			sourceBranch: meta?.sourceBranch ?? "",
			targetBranch: meta?.targetBranch ?? "",
			repoPath: useTabStore.getState().activeWorkspaceCwd,
		};
	}, [meta]);

	// Check if a solve session is in progress
	const sessions = sessionsQuery.data ?? [];
	const isSessionInProgress = sessions.some((s) => s.status === "queued" || s.status === "running");

	// Transform raw comments into UnifiedThread format
	const threads: UnifiedThread[] = useMemo(
		() =>
			comments.map((c) => ({
				id: c.platformId,
				isResolved: false,
				path: c.filePath ?? "",
				line: c.lineNumber ?? null,
				diffSide: "RIGHT" as const,
				isAIDraft: false as const,
				comments: [
					{
						id: c.platformId,
						body: c.body,
						author: c.author,
						authorAvatarUrl: "",
						createdAt: c.createdAt,
					},
				],
			})),
		[comments]
	);

	// Skipped IDs track platformIds; map them to thread ids (same value here)
	const includedCount = threads.length - skippedIds.size;

	const toggleSkip = (platformId: string) => {
		setSkippedIds((prev) => {
			const next = new Set(prev);
			if (next.has(platformId)) {
				next.delete(platformId);
			} else {
				next.add(platformId);
			}
			return next;
		});
	};

	// Grouped / sorted views
	const grouped = useMemo(() => {
		if (sortMode === "latest-first") return null;
		const map = new Map<string, UnifiedThread[]>();
		for (const t of threads) {
			const key = sortMode === "by-file" ? t.path : threadAuthor(t);
			const list = map.get(key);
			if (list) list.push(t);
			else map.set(key, [t]);
		}
		return map;
	}, [threads, sortMode]);

	const flatSorted = useMemo(() => {
		if (sortMode !== "latest-first") return null;
		return [...threads].sort(
			(a, b) => new Date(threadDate(b)).getTime() - new Date(threadDate(a)).getTime()
		);
	}, [threads, sortMode]);

	const handleSolve = () => {
		triggerSolve.mutate(
			{
				workspaceId,
				excludeCommentIds: [...skippedIds],
			},
			{
				onSuccess: (launchInfo) => {
					utils.commentSolver.getSolveSessions.invalidate({ workspaceId });

					const tabStore = useTabStore.getState();
					const tabId = tabStore.addTerminalTab(
						launchInfo.workspaceId,
						launchInfo.worktreePath,
						"AI Solver"
					);
					attachTerminal.mutate({
						workspaceId: launchInfo.workspaceId,
						terminalId: tabId,
					});

					setTimeout(() => {
						window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\r`);
					}, 1000);
				},
			}
		);
	};

	const handleNavigate = (path: string) => {
		const cwd = useTabStore.getState().activeWorkspaceCwd;
		if (!cwd) return;
		useTabStore.getState().openFile(workspaceId, cwd, path, detectLanguage(path), undefined);
	};

	const provider = meta?.prProvider ?? "github";

	// GitHub APIs
	const ghAddComment = trpc.github.addReviewComment.useMutation({
		onSuccess: () => commentsQuery.refetch(),
	});
	const ghResolveThread = trpc.github.resolveThread.useMutation({
		onSuccess: () => commentsQuery.refetch(),
	});

	// Bitbucket APIs
	const bbReplyComment = trpc.atlassian.replyToPRComment.useMutation({
		onSuccess: () => commentsQuery.refetch(),
	});
	const bbResolveComment = trpc.atlassian.resolvePRComment.useMutation({
		onSuccess: () => commentsQuery.refetch(),
	});

	const handleReply = (threadId: string, body: string) => {
		if (provider === "github") {
			ghAddComment.mutate({ threadId, body });
		} else {
			bbReplyComment.mutate({
				workspace: prCtx.owner,
				repoSlug: prCtx.repo,
				prId: prCtx.number,
				parentCommentId: parseInt(threadId, 10),
				body,
			});
		}
	};

	const handleResolve = (threadId: string) => {
		if (provider === "github") {
			ghResolveThread.mutate({ threadId });
		} else {
			bbResolveComment.mutate({
				workspace: prCtx.owner,
				repoSlug: prCtx.repo,
				prId: prCtx.number,
				commentId: parseInt(threadId, 10),
				resolved: true,
			});
		}
	};

	const renderThread = (t: UnifiedThread) => {
		const isSkipped = skippedIds.has(t.id);
		return (
			<div key={t.id} className={isSkipped ? "opacity-40" : ""}>
				<CommentThreadCard
					thread={t}
					prCtx={prCtx}
					onNavigate={handleNavigate}
					onReply={handleReply}
					onResolve={handleResolve}
					extraAction={
						<button
							type="button"
							onClick={() => toggleSkip(t.id)}
							className="text-[9px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)] transition-colors"
						>
							{isSkipped ? "Include" : "Skip"}
						</button>
					}
				/>
			</div>
		);
	};

	// ── Error state ───────────────────────────────────────────────────────

	if (commentsQuery.isError) {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<PRHeader
					title={prTitle}
					prNumber={prNumber}
					sourceBranch={sourceBranch}
					commentCount={0}
				/>
				<div className="flex flex-1 flex-col items-center justify-center gap-3">
					<div className="max-w-[280px] text-center text-[11px] text-[#ff453a]">
						{commentsQuery.error.message}
					</div>
					<button
						type="button"
						onClick={() => commentsQuery.refetch()}
						className="rounded-[6px] bg-[var(--bg-elevated)] px-3 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] transition-colors"
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	// ── Loading state ─────────────────────────────────────────────────────

	if (commentsQuery.isLoading) {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<PRHeader
					title={prTitle}
					prNumber={prNumber}
					sourceBranch={sourceBranch}
					commentCount={0}
				/>
				<div className="flex flex-1 flex-col items-center justify-center gap-3">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-3 animate-pulse rounded bg-[var(--bg-elevated)]"
							style={{ width: `${180 - i * 30}px` }}
						/>
					))}
					<div className="mt-2 text-[11px] text-[var(--text-quaternary)]">Loading comments...</div>
				</div>
			</div>
		);
	}

	// ── Empty state ───────────────────────────────────────────────────────

	if (comments.length === 0) {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<PRHeader
					title={prTitle}
					prNumber={prNumber}
					sourceBranch={sourceBranch}
					commentCount={0}
				/>
				<div className="flex flex-1 items-center justify-center">
					<span className="text-[12px] text-[var(--text-quaternary)]">No comments on this PR</span>
				</div>
			</div>
		);
	}

	// ── Main render ───────────────────────────────────────────────────────

	return (
		<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
			<PRHeader
				title={prTitle}
				prNumber={prNumber}
				sourceBranch={sourceBranch}
				commentCount={threads.length}
			/>

			{isSessionInProgress && <SolvingBanner />}

			{/* Sort control */}
			<div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5">
				<span className="text-[11px] text-[var(--text-tertiary)]">
					{threads.length} thread{threads.length !== 1 ? "s" : ""}
				</span>
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

			{/* Thread list */}
			<div className="flex-1 overflow-y-auto py-1">
				{sortMode === "latest-first" && flatSorted
					? flatSorted.map(renderThread)
					: grouped &&
						Array.from(grouped.entries()).map(([key, groupThreads]) => (
							<div key={key}>
								<div className="px-3 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
									{key}
								</div>
								{groupThreads.map(renderThread)}
							</div>
						))}
			</div>

			{/* Solve button */}
			<div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5">
				{triggerSolve.isError && (
					<div className="mb-2 text-[10px] text-[#ff453a]">{triggerSolve.error.message}</div>
				)}
				<button
					type="button"
					onClick={handleSolve}
					disabled={triggerSolve.isPending || includedCount === 0 || isSessionInProgress}
					className="w-full rounded-[6px] bg-[var(--accent)] px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
				>
					{triggerSolve.isPending
						? "Starting..."
						: `Solve with AI (${includedCount} comment${includedCount !== 1 ? "s" : ""})`}
				</button>
			</div>
		</div>
	);
}
