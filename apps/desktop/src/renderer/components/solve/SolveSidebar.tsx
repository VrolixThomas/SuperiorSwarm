import { useEffect, useMemo, useRef } from "react";
import type { SolveGroupInfo, SolveSessionInfo } from "../../../shared/solve-types";
import { basename } from "../../lib/format";
import { solveSessionKey, useSolveSessionStore } from "../../stores/solve-session-store";
import { trpc } from "../../trpc/client";
import { GroupAction } from "./GroupAction";
import { RatioBadge } from "./RatioBadge";
import { SolveCommentCard } from "./SolveCommentCard";

interface Props {
	session: SolveSessionInfo;
}

interface FileRow {
	groupId: string;
	path: string;
	additions: number;
	deletions: number;
	isUnchanged: boolean; // commented-on but not in changedFiles
}

export function buildSidebarRows(groups: SolveGroupInfo[]): Map<string, FileRow[]> {
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
		// Add commented-on files not in changedFiles (rare but real for the group's
		// own file-level comments).
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

export function SolveSidebar({ session }: Props) {
	const utils = trpc.useUtils();
	const sessionKey = solveSessionKey(session.workspaceId, session.id);

	const expanded = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.expandedGroupIds ?? new Set<string>()
	);
	const activeFilePath = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeFilePath ?? null
	);
	const activeCommentId = useSolveSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeCommentId ?? null
	);
	const selectFile = useSolveSessionStore((s) => s.selectFile);
	const selectComment = useSolveSessionStore((s) => s.selectComment);
	const toggleGroupExpanded = useSolveSessionStore((s) => s.toggleGroupExpanded);
	const setFileOrder = useSolveSessionStore((s) => s.setFileOrder);
	const setExpandedGroups = useSolveSessionStore((s) => s.setExpandedGroups);

	const approveMutation = trpc.commentSolver.approveGroup.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});
	const pushMutation = trpc.commentSolver.pushGroup.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});
	const revokeMutation = trpc.commentSolver.revokeGroup.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const rowsByGroup = useMemo(() => buildSidebarRows(session.groups), [session.groups]);

	// Flatten all file paths in order for j/k navigation — skip reverted groups.
	const flatFileOrder = useMemo(() => {
		const out: string[] = [];
		for (const g of session.groups.filter((g) => g.status !== "reverted")) {
			const rows = rowsByGroup.get(g.id) ?? [];
			for (const r of rows) out.push(r.path);
		}
		return out;
	}, [session.groups, rowsByGroup]);

	useEffect(() => {
		setFileOrder(sessionKey, flatFileOrder);
	}, [sessionKey, flatFileOrder, setFileOrder]);

	// First-load: expand the first non-empty non-reverted group, auto-select its first file.
	useEffect(() => {
		if (expanded.size > 0 || activeFilePath !== null) return;
		const first = session.groups
			.filter((g) => g.status !== "reverted")
			.find((g) => (rowsByGroup.get(g.id) ?? []).length > 0);
		if (!first) return;
		setExpandedGroups(sessionKey, new Set([first.id]));
		const firstRow = rowsByGroup.get(first.id)?.[0];
		if (firstRow) selectFile(sessionKey, firstRow.path);
	}, [
		sessionKey,
		expanded.size,
		activeFilePath,
		session.groups,
		rowsByGroup,
		setExpandedGroups,
		selectFile,
	]);

	const activeCardRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		activeCardRef.current?.scrollIntoView({ block: "nearest" });
	}, [activeCommentId]);

	return (
		<div className="flex h-full flex-col overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--bg-base)]">
			{session.groups.map((group) => {
				const rows = rowsByGroup.get(group.id) ?? [];
				const isExpanded = expanded.has(group.id);
				const isSolving = group.status === "pending";
				const isReverted = group.status === "reverted";
				const draftReplyCount = group.comments.filter((c) => c.reply?.status === "draft").length;
				return (
					<div key={group.id} className="border-b border-[var(--border-subtle)]">
						<div
							onClick={
								isReverted || isSolving
									? undefined
									: () => toggleGroupExpanded(sessionKey, group.id)
							}
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
									<GroupAction
										group={group}
										onApprove={() => approveMutation.mutate({ groupId: group.id })}
										onRevoke={() => revokeMutation.mutate({ groupId: group.id })}
										onPush={() => pushMutation.mutate({ groupId: group.id })}
										isPushing={pushMutation.isPending}
									/>
								</div>
							)}
						</div>
						{!isReverted && isExpanded && !isSolving && (
							<div className="pb-[6px]">
								{/* FILES subsection */}
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
											onClick={() => selectFile(sessionKey, row.path)}
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
								{/* COMMENTS subsection */}
								{group.comments.length > 0 && (
									<>
										<div className="px-[12px] pb-[4px] pt-[6px] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
											Comments
										</div>
										{group.comments.map((comment) => {
											const isActive = activeCommentId === comment.id;
											return (
												<div
													key={comment.id}
													ref={isActive ? activeCardRef : undefined}
												>
													<SolveCommentCard
														comment={comment}
														workspaceId={session.workspaceId}
														variant="sidebar"
														isActive={isActive}
														onSelect={() => {
															selectFile(sessionKey, comment.filePath);
															selectComment(sessionKey, comment.id);
														}}
													/>
												</div>
											);
										})}
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
