// Mirrors apps/desktop/src/renderer/components/solve/SolveSidebar.tsx. Static (no tRPC, no stores) — inlines GroupAction, RatioBadge, SolveCommentCard.

import type { SolveCommentInfo, SolveGroupInfo, SolveSessionInfo } from "./SolveReviewTab";

interface Props {
	session: SolveSessionInfo;
	expandedGroupIds: ReadonlySet<string>;
	activeFilePath: string | null;
}

interface FileRow {
	groupId: string;
	path: string;
	additions: number;
	deletions: number;
	isUnchanged: boolean;
}

function basename(path: string): string {
	return path.split("/").pop() ?? path;
}

function buildSidebarRows(groups: SolveGroupInfo[]): Map<string, FileRow[]> {
	const byGroup = new Map<string, FileRow[]>();
	for (const g of groups) {
		const rows: FileRow[] = [];
		const seen = new Set<string>();
		for (const f of g.changedFiles) {
			if (seen.has(f.path)) continue;
			seen.add(f.path);
			rows.push({
				groupId: g.id,
				path: f.path,
				additions: f.additions,
				deletions: f.deletions,
				isUnchanged: false,
			});
		}
		for (const c of g.comments) {
			if (seen.has(c.filePath)) continue;
			seen.add(c.filePath);
			rows.push({
				groupId: g.id,
				path: c.filePath,
				additions: 0,
				deletions: 0,
				isUnchanged: true,
			});
		}
		byGroup.set(g.id, rows);
	}
	return byGroup;
}

export function SolveSidebar({ session, expandedGroupIds, activeFilePath }: Props) {
	const rowsByGroup = buildSidebarRows(session.groups);

	return (
		<div className="flex h-full flex-col overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--bg-base)]">
			{session.groups.map((group) => {
				const rows = rowsByGroup.get(group.id) ?? [];
				const isExpanded = expandedGroupIds.has(group.id);
				const isSolving = group.status === "pending";
				const isReverted = group.status === "reverted";
				const draftReplyCount = group.comments.filter((c) => c.reply?.status === "draft").length;
				return (
					<div key={group.id} className="border-b border-[var(--border-subtle)]">
						<div
							className={[
								"flex items-center justify-between px-[12px] py-[10px] select-none",
								isReverted || isSolving ? "cursor-default" : "cursor-pointer",
								isReverted ? "opacity-50" : "",
							].join(" ")}
						>
							<div className="flex items-center gap-[7px] min-w-0 flex-1">
								<span
									className="text-[10px] text-[var(--text-tertiary)] w-[14px] text-center transition-transform duration-[150ms]"
									style={{ transform: isExpanded && !isReverted ? "rotate(90deg)" : "none" }}
								>
									›
								</span>
								<span
									title={group.label}
									className={[
										"text-[13px] font-medium tracking-[-0.015em] whitespace-nowrap overflow-hidden text-ellipsis",
										isReverted ? "line-through" : "",
									].join(" ")}
								>
									{group.label}
								</span>
								{!isReverted && <RatioBadge group={group} />}
								{!isReverted && draftReplyCount > 0 && (
									<span className="shrink-0 py-[1px] px-[7px] rounded-full text-[10px] font-medium bg-[var(--warning-subtle)] text-[var(--warning)]">
										✉ {draftReplyCount} draft
									</span>
								)}
							</div>
							{!isReverted && (
								<div className="flex items-center gap-[6px] shrink-0 ml-[12px]">
									<GroupAction group={group} />
								</div>
							)}
						</div>
						{!isReverted && isExpanded && !isSolving && (
							<div className="pb-[6px]">
								<div className="px-[12px] pb-[4px] pt-[2px] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
									Files
								</div>
								{rows.length === 0 && (
									<div className="pl-[26px] pr-[10px] pb-[6px] font-mono text-[10.5px] text-[var(--text-tertiary)]">
										no code changes
									</div>
								)}
								{rows.map((row) => {
									const selected = row.path === activeFilePath;
									return (
										<div
											key={row.path}
											title={row.path}
											className={[
												"flex items-center gap-[8px] py-[5px] pl-[26px] pr-[10px] cursor-pointer border-l-2",
												selected
													? "bg-[var(--bg-active)] border-[var(--accent)]"
													: "border-transparent hover:bg-[var(--bg-elevated)]",
											].join(" ")}
										>
											<span className="text-[var(--text-tertiary)] text-[11px]">⬡</span>
											<span className="font-mono text-[11.5px] text-[var(--accent)] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
												{basename(row.path)}
											</span>
											{row.isUnchanged ? (
												<span className="font-mono text-[10px] text-[var(--text-tertiary)] shrink-0">
													(unchanged)
												</span>
											) : (
												<span className="font-mono text-[10px] text-[var(--text-tertiary)] shrink-0">
													{row.additions > 0 && (
														<span className="text-[var(--success)] opacity-70">
															+{row.additions}
														</span>
													)}
													{row.additions > 0 && row.deletions > 0 && " "}
													{row.deletions > 0 && (
														<span className="text-[var(--danger)] opacity-70">
															−{row.deletions}
														</span>
													)}
												</span>
											)}
										</div>
									);
								})}
								{group.comments.length > 0 && (
									<>
										<div className="px-[12px] pb-[4px] pt-[6px] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
											Comments
										</div>
										{group.comments.map((comment) => (
											<div key={comment.id}>
												<SolveCommentCard comment={comment} />
											</div>
										))}
									</>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

function RatioBadge({ group }: { group: SolveGroupInfo }) {
	const fixed = group.comments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	const total = group.comments.length;
	const hasUnclear = group.comments.some((c) => c.status === "unclear");

	const bg =
		total === 0
			? "var(--bg-active)"
			: fixed === total
				? "var(--success-subtle)"
				: hasUnclear
					? "var(--warning-subtle)"
					: "var(--bg-active)";
	const color =
		total === 0
			? "var(--text-tertiary)"
			: fixed === total
				? "var(--success)"
				: hasUnclear
					? "var(--warning)"
					: "var(--text-tertiary)";

	return (
		<span
			className="shrink-0 py-[1px] px-[7px] rounded-full font-mono text-[10px] font-medium"
			style={{ background: bg, color }}
		>
			{fixed}/{total}
		</span>
	);
}

function GroupAction({ group }: { group: SolveGroupInfo }) {
	if (group.status === "pending") {
		return (
			<span className="flex items-center gap-[6px] text-[11.5px] text-[var(--accent)] font-medium">
				<span
					className="w-[6px] h-[6px] rounded-full bg-[var(--accent)]"
					style={{ animation: "blink 1.6s ease-in-out infinite" }}
				/>
				Solving
			</span>
		);
	}
	if (group.status === "submitted") {
		return (
			<span className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium bg-[var(--success-subtle)] text-[var(--success)]">
				✓ Pushed
			</span>
		);
	}
	if (group.status === "approved") {
		const hasDraftReplies = group.comments.some((c) => c.reply?.status === "draft");
		return (
			<div className="flex items-center gap-[6px]">
				<button
					type="button"
					className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium text-[var(--text-tertiary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
				>
					Revoke
				</button>
				{hasDraftReplies ? (
					<span className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)]">
						✓ Approved
					</span>
				) : (
					<button
						type="button"
						className="py-[4px] px-[12px] rounded-[6px] text-[11.5px] font-semibold border-none cursor-pointer bg-[var(--success)] text-[var(--accent-foreground)]"
					>
						Push & post
					</button>
				)}
			</div>
		);
	}
	if (group.status === "fixed") {
		return (
			<button
				type="button"
				className="py-[4px] px-[12px] rounded-[6px] text-[11.5px] font-medium bg-[var(--success-subtle)] text-[var(--success)] border-none cursor-pointer"
			>
				Approve
			</button>
		);
	}
	return null;
}

function CommentBody({ body }: { body: string }) {
	const parts = body.split(/```/g);
	return (
		<>
			{parts.map((part, idx) => {
				const key = `${idx}-${part.slice(0, 8)}`;
				if (idx % 2 === 1) {
					return (
						<pre
							key={key}
							className="my-[6px] py-[6px] px-[10px] bg-[var(--bg-elevated)] rounded-[4px] font-mono text-[11px] text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap"
						>
							{part.trim()}
						</pre>
					);
				}
				return part.split("\n\n").map((para) => {
					if (!para.trim()) return null;
					return (
						<p key={`${key}-${para.slice(0, 16)}`} className="my-[4px] whitespace-pre-wrap">
							{para}
						</p>
					);
				});
			})}
		</>
	);
}

function SolveCommentCard({ comment }: { comment: SolveCommentInfo }) {
	const statusColor =
		comment.status === "fixed" || comment.status === "wont_fix"
			? "var(--success)"
			: comment.status === "unclear"
				? "var(--warning)"
				: comment.status === "changes_requested"
					? "var(--accent)"
					: "var(--text-tertiary)";

	const statusLabel =
		comment.status === "fixed"
			? "✓ Fixed"
			: comment.status === "unclear"
				? "? Unclear"
				: comment.status === "changes_requested"
					? "↻ Changes requested"
					: comment.status === "wont_fix"
						? "— Won't fix"
						: "Pending";

	const wrapperClass = [
		"w-full border-t border-[var(--border-subtle)] bg-[var(--bg-base)] text-[11px] cursor-pointer hover:bg-[var(--bg-elevated)] border-l-2",
		"border-l-transparent",
	].join(" ");

	const lineRef = comment.lineNumber != null ? `line ${comment.lineNumber}` : "file-level";

	return (
		<div className={wrapperClass}>
			<div className="flex items-center gap-[6px] px-3 py-2">
				<div className="w-[16px] h-[16px] rounded-full bg-[var(--bg-active)] flex items-center justify-center text-[8px] font-semibold text-[var(--text-secondary)]">
					{comment.author.charAt(0).toUpperCase()}
				</div>
				<span className="text-[12px] font-medium">{comment.author}</span>
				<span
					className="font-mono text-[10.5px] text-[var(--text-tertiary)]"
					title={`${comment.filePath}${comment.lineNumber != null ? `:${comment.lineNumber}` : " (file-level)"}`}
				>
					{`${basename(comment.filePath)} · ${lineRef}`}
				</span>
				<span className="ml-auto text-[10.5px] font-medium" style={{ color: statusColor }}>
					{statusLabel}
				</span>
			</div>
			<div className="px-3 pb-2 text-[12px] text-[var(--text-secondary)] leading-[1.55]">
				<CommentBody body={comment.body} />
			</div>
			<div className="flex items-center gap-[8px] px-3 pb-2">
				{(comment.status === "fixed" || comment.status === "unclear") && (
					<button
						type="button"
						className="text-[10.5px] text-[var(--text-tertiary)] bg-transparent border-none cursor-pointer underline underline-offset-2"
					>
						Follow up
					</button>
				)}
			</div>
		</div>
	);
}
