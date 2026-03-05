import { useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import type { GitHubPR } from "../../main/github/github";

// ── Review decision badge ────────────────────────────────────────────────────

function ReviewBadge({ decision }: { decision: GitHubPR["reviewDecision"] }) {
	if (!decision) return null;
	const config = {
		approved: { label: "Approved", color: "text-green-400" },
		changes_requested: { label: "Changes", color: "text-red-400" },
		review_required: { label: "Review", color: "text-yellow-400" },
	} as const;
	const { label, color } = config[decision];
	return <span className={`shrink-0 text-[10px] font-medium ${color}`}>{label}</span>;
}

// ── Comment list (lazy-loaded when PR is expanded) ───────────────────────────

function PRCommentList({ owner, repo, number }: { owner: string; repo: string; number: number }) {
	const { data: comments, isLoading } = trpc.github.getPRComments.useQuery(
		{ owner, repo, number },
		{ staleTime: 60_000 }
	);

	if (isLoading) {
		return (
			<div className="mt-1 px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	if (!comments || comments.length === 0) {
		return (
			<div className="px-3 py-1 text-[11px] text-[var(--text-quaternary)]">No comments</div>
		);
	}

	return (
		<div className="flex flex-col gap-1 py-1">
			{comments.map((comment) => (
				<div key={comment.id} className="rounded-[4px] bg-[var(--bg-elevated)] px-3 py-1.5">
					{comment.kind === "review" && comment.path && (
						<div className="mb-0.5 text-[10px] text-[var(--text-quaternary)] font-mono truncate">
							{comment.path}{comment.line ? `:${comment.line}` : ""}
						</div>
					)}
					<div className="text-[11px] text-[var(--text-tertiary)] line-clamp-3">{comment.body}</div>
					<div className="mt-0.5 text-[10px] text-[var(--text-quaternary)]">
						{comment.author} · {new Date(comment.createdAt).toLocaleDateString()}
					</div>
				</div>
			))}
		</div>
	);
}

// ── PR row ───────────────────────────────────────────────────────────────────

function PRRow({ pr, isLinked }: { pr: GitHubPR; isLinked: boolean }) {
	const utils = trpc.useUtils();
	const [expanded, setExpanded] = useState(false);
	const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

	const linkMutation = trpc.github.linkPR.useMutation({
		onSuccess: () => utils.github.getLinkedPRs.invalidate(),
	});

	// For linking, we'd need to know which workspace — for now open a popover
	// or use the active workspace. Keep it simple: link to the active workspace.
	const { activeWorkspaceId } = useTabStore();

	return (
		<>
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				onContextMenu={(e) => {
					e.preventDefault();
					setContextMenu({ x: e.clientX, y: e.clientY });
				}}
				className={`flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] ${
					isLinked
						? "text-[var(--text-secondary)]"
						: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
				}`}
				title={`${pr.repoOwner}/${pr.repoName}#${pr.number}`}
			>
				{/* Draft indicator */}
				{pr.isDraft && (
					<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">[Draft]</span>
				)}
				<span className="min-w-0 flex-1 truncate">{pr.title}</span>
				<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
					{pr.repoOwner}/{pr.repoName}
				</span>
				<ReviewBadge decision={pr.reviewDecision} />
				{/* Comment count */}
				{pr.commentCount > 0 && (
					<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
						{pr.commentCount}
					</span>
				)}
				{/* Linked indicator */}
				{isLinked && (
					<svg
						aria-hidden="true"
						width="10"
						height="10"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="shrink-0 text-[var(--accent)]"
					>
						<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
						<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
					</svg>
				)}
			</button>

			{/* Expanded comments */}
			{expanded && (
				<PRCommentList owner={pr.repoOwner} repo={pr.repoName} number={pr.number} />
			)}

			{/* Simple context menu */}
			{contextMenu && (
				<div
					className="fixed z-50 min-w-[160px] rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-overlay)] py-1 shadow-lg"
					style={{ top: contextMenu.y, left: contextMenu.x }}
					onMouseLeave={() => setContextMenu(null)}
				>
					<button
						type="button"
						className="flex w-full items-center px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
						onClick={() => {
							setContextMenu(null);
							window.open(pr.url, "_blank");
						}}
					>
						Open on GitHub
					</button>
					{activeWorkspaceId && (
						<button
							type="button"
							className="flex w-full items-center px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
							onClick={() => {
								setContextMenu(null);
								linkMutation.mutate({
									workspaceId: activeWorkspaceId,
									owner: pr.repoOwner,
									repo: pr.repoName,
									number: pr.number,
								});
							}}
						>
							Link to current workspace
						</button>
					)}
				</div>
			)}
		</>
	);
}

// ── Group header ─────────────────────────────────────────────────────────────

function GroupLabel({ label }: { label: string }) {
	return (
		<div className="px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-quaternary)]">
			{label}
		</div>
	);
}

// ── Main list ────────────────────────────────────────────────────────────────

export function GitHubPRList() {
	const { data: prs, isLoading } = trpc.github.getMyPRs.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	const { data: linkedPRs } = trpc.github.getLinkedPRs.useQuery(undefined, { staleTime: 30_000 });

	const linkedSet = new Set(
		(linkedPRs ?? []).map((l) => `${l.prRepoOwner}/${l.prRepoName}#${l.prNumber}`)
	);

	if (isLoading && !prs) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	const authored = (prs ?? []).filter((p) => p.role === "author");
	const reviewing = (prs ?? []).filter((p) => p.role === "reviewer");

	if (authored.length === 0 && reviewing.length === 0) {
		return (
			<div className="px-3 py-1 text-[12px] text-[var(--text-quaternary)]">No open PRs</div>
		);
	}

	return (
		<div className="flex flex-col gap-0.5">
			{authored.length > 0 && (
				<>
					<GroupLabel label="Authored" />
					{authored.map((pr) => (
						<PRRow
							key={pr.id}
							pr={pr}
							isLinked={linkedSet.has(`${pr.repoOwner}/${pr.repoName}#${pr.number}`)}
						/>
					))}
				</>
			)}
			{reviewing.length > 0 && (
				<>
					<GroupLabel label="Reviewing" />
					{reviewing.map((pr) => (
						<PRRow
							key={pr.id}
							pr={pr}
							isLinked={linkedSet.has(`${pr.repoOwner}/${pr.repoName}#${pr.number}`)}
						/>
					))}
				</>
			)}
		</div>
	);
}
