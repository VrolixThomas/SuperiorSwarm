import { useState } from "react";
import { COMMIT_GROUPS } from "./mock-data";

// ── Commit Group Card ────────────────────────────────────────────────────────

function CommitGroupCard({
	group,
	defaultExpanded,
}: {
	group: (typeof COMMIT_GROUPS)[number];
	defaultExpanded: boolean;
}) {
	const [expanded, setExpanded] = useState(defaultExpanded);

	const allFixed = group.resolved === group.total && group.total > 0;
	const badgeBg = allFixed ? "bg-green/15" : "bg-bg-overlay";
	const badgeText = allFixed ? "text-green" : "text-text-faint";

	return (
		<div className="overflow-hidden rounded-[6px] border border-border bg-bg-surface">
			{/* Header — label + badge + actions */}
			<button
				type="button"
				onClick={() => setExpanded((prev) => !prev)}
				className="w-full px-3 py-1.5 text-left transition-colors hover:bg-bg-elevated"
			>
				{/* Row 1: chevron + label + progress badge */}
				<div className="flex items-start gap-1.5">
					<span className="mt-0.5 shrink-0 text-[10px] text-text-faint">
						{expanded ? "\u25BE" : "\u25B8"}
					</span>
					<span className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-text-secondary">
						{group.label}
					</span>
					<span
						className={`mt-0.5 shrink-0 rounded-[3px] px-1.5 py-px text-[9px] font-semibold ${badgeBg} ${badgeText}`}
					>
						{group.resolved}/{group.total}
					</span>
				</div>

				{/* Row 2: Approve + Follow up actions */}
				<div className="mt-1 flex items-center gap-2 pl-4">
					{group.approved && (
						<span className="rounded-[4px] bg-green/15 px-2 py-0.5 text-[10px] font-medium text-green">
							Approve
						</span>
					)}
					<span className="rounded-[4px] px-2 py-0.5 text-[10px] text-text-faint transition-colors hover:text-text-secondary">
						Follow up
					</span>
				</div>
			</button>

			{/* Sub-header: commit hash + file names */}
			<div className="border-t border-border px-3 py-1.5">
				<div className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-text-faint">
					{group.commits.map((hash) => (
						<span key={hash}>{hash}</span>
					))}
					{group.commits.length > 0 && group.files.length > 0 && <span>&middot;</span>}
					{group.files.map((file, i) => (
						<span key={file} className="flex items-center gap-1">
							{i > 0 && <span>,</span>}
							<span className="text-text-faint hover:text-accent hover:underline">{file}</span>
						</span>
					))}
				</div>
			</div>

			{/* Expanded content: comment threads */}
			{expanded && group.comments.length > 0 && (
				<div className="flex flex-col divide-y divide-border border-t border-border">
					{group.comments.map((comment, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static mock data
						<div key={i} className="px-3 py-2">
							{/* Author + file:line */}
							<div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
								<span className="font-bold text-text-secondary">{comment.author}</span>
								<span className="font-mono text-text-faint hover:text-text-secondary hover:underline">
									{comment.file}
									{comment.line != null && `:${comment.line}`}
								</span>
							</div>
							{/* Comment body */}
							<p className="whitespace-pre-wrap text-[11px] leading-[1.5] text-text-muted">
								{comment.text}
							</p>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── Main CommentSolverView ───────────────────────────────────────────────────

export function CommentSolverView() {
	const totalResolved = COMMIT_GROUPS.reduce((s, g) => s + g.resolved, 0);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-bg-base">
			{/* PR Header */}
			<div className="shrink-0 border-b border-border px-4 py-3">
				{/* Top row: label */}
				<div className="flex items-center justify-between">
					<span className="text-[10px] uppercase tracking-[0.5px] text-text-faint">
						Pull Request
					</span>
				</div>
				{/* PR title (branch name as title in solver mode) */}
				<h1 className="mt-1 truncate font-mono text-[13px] font-semibold text-text-primary">
					#34 &middot; feature/inline-agent-chat
				</h1>
				{/* Status summary */}
				<div className="mt-1.5 flex items-center gap-3 text-[10px]">
					<span className="flex items-center gap-1">
						<span className="inline-block size-[5px] rounded-full bg-green" />
						<span className="text-text-secondary">{totalResolved} resolved</span>
					</span>
				</div>
			</div>

			{/* Commit Groups section */}
			<div className="flex-1 overflow-y-auto px-3 py-2">
				<div className="mb-2 text-[10px] uppercase tracking-[0.5px] text-text-faint">
					{COMMIT_GROUPS.length} Commit Groups
				</div>

				<div className="flex flex-col gap-2.5">
					{COMMIT_GROUPS.map((group, i) => (
						<CommitGroupCard
							// biome-ignore lint/suspicious/noArrayIndexKey: static mock data
							key={i}
							group={group}
							defaultExpanded={i === 0}
						/>
					))}
				</div>
			</div>

			{/* Bottom action bar */}
			<div className="shrink-0 border-t border-border bg-bg-elevated">
				<div className="flex items-center gap-2 px-4 py-2.5">
					<button
						type="button"
						className="flex-1 rounded-[6px] bg-green/90 px-4 py-1.5 text-[11px] font-semibold text-black transition-colors hover:bg-green"
					>
						Push changes & post replies
					</button>
					<button
						type="button"
						className="rounded-[6px] border border-border bg-transparent px-4 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-overlay"
					>
						Revert all
					</button>
				</div>
			</div>
		</div>
	);
}
