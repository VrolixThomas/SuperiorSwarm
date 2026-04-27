import { useEffect, useMemo } from "react";
import type { SolveGroupInfo, SolveSessionInfo } from "../../../shared/solve-types";
import { useSolveSessionStore } from "../../stores/solve-session-store";
import { trpc } from "../../trpc/client";
import { GroupAction } from "./GroupAction";
import { RatioBadge } from "./RatioBadge";

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
	const sessionId = session.id;

	const expanded = useSolveSessionStore(
		(s) => s.sessions.get(sessionId)?.expandedGroupIds ?? new Set<string>()
	);
	const activeFilePath = useSolveSessionStore(
		(s) => s.sessions.get(sessionId)?.activeFilePath ?? null
	);
	const selectFile = useSolveSessionStore((s) => s.selectFile);
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

	const visibleGroups = useMemo(
		() => session.groups.filter((g) => g.status !== "reverted"),
		[session.groups]
	);

	const rowsByGroup = useMemo(() => buildSidebarRows(visibleGroups), [visibleGroups]);

	// Flatten all file paths in order for j/k navigation.
	const flatFileOrder = useMemo(() => {
		const out: string[] = [];
		for (const g of visibleGroups) {
			const rows = rowsByGroup.get(g.id) ?? [];
			for (const r of rows) out.push(r.path);
		}
		return out;
	}, [visibleGroups, rowsByGroup]);

	useEffect(() => {
		setFileOrder(sessionId, flatFileOrder);
	}, [sessionId, flatFileOrder, setFileOrder]);

	// First-load: expand the first non-empty group, auto-select its first file.
	useEffect(() => {
		if (expanded.size > 0 || activeFilePath !== null) return;
		const first = visibleGroups.find((g) => (rowsByGroup.get(g.id) ?? []).length > 0);
		if (!first) return;
		setExpandedGroups(sessionId, new Set([first.id]));
		const firstRow = rowsByGroup.get(first.id)?.[0];
		if (firstRow) selectFile(sessionId, firstRow.path);
	}, [
		sessionId,
		expanded.size,
		activeFilePath,
		visibleGroups,
		rowsByGroup,
		setExpandedGroups,
		selectFile,
	]);

	return (
		<div className="flex h-full flex-col overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--bg-base)]">
			{visibleGroups.map((group) => {
				const rows = rowsByGroup.get(group.id) ?? [];
				const isExpanded = expanded.has(group.id);
				const isSolving = group.status === "pending";
				const draftReplyCount = group.comments.filter((c) => c.reply?.status === "draft").length;
				return (
					<div key={group.id} className="border-b border-[var(--border-subtle)]">
						<div
							onClick={() => !isSolving && toggleGroupExpanded(sessionId, group.id)}
							className={[
								"flex items-center justify-between px-[12px] py-[10px] select-none",
								isSolving ? "cursor-default" : "cursor-pointer",
							].join(" ")}
						>
							<div className="flex items-center gap-[7px] min-w-0 flex-1">
								<span
									className="text-[10px] text-[var(--text-tertiary)] w-[14px] text-center transition-transform duration-[150ms]"
									style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}
								>
									›
								</span>
								<span className="text-[13px] font-medium tracking-[-0.015em] whitespace-nowrap overflow-hidden text-ellipsis">
									{group.label}
								</span>
								<RatioBadge group={group} />
								{draftReplyCount > 0 && (
									<span className="shrink-0 py-[1px] px-[7px] rounded-full text-[10px] font-medium bg-[var(--warning-subtle)] text-[var(--warning)]">
										✉ {draftReplyCount} draft
									</span>
								)}
							</div>
							<div className="flex items-center gap-[6px] shrink-0 ml-[12px]">
								<GroupAction
									group={group}
									onApprove={() => approveMutation.mutate({ groupId: group.id })}
									onRevoke={() => revokeMutation.mutate({ groupId: group.id })}
									onPush={() => pushMutation.mutate({ groupId: group.id })}
									isPushing={pushMutation.isPending}
								/>
							</div>
						</div>
						{isExpanded && !isSolving && (
							<div className="pb-[6px]">
								{rows.length === 0 && (
									<div className="px-[12px] pb-[6px] font-mono text-[10.5px] text-[var(--text-tertiary)]">
										no code changes
									</div>
								)}
								{rows.map((row) => {
									const selected = row.path === activeFilePath;
									return (
										<div
											key={row.path}
											onClick={() => selectFile(sessionId, row.path)}
											className={[
												"flex items-center gap-[8px] py-[5px] pl-[26px] pr-[10px] cursor-pointer",
												selected ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-elevated)]",
											].join(" ")}
										>
											<span className="text-[var(--text-tertiary)] text-[11px]">⬡</span>
											<span className="font-mono text-[11.5px] text-[var(--accent)] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
												{row.path}
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
							</div>
						)}
					</div>
				);
			})}
			{session.groups.some((g) => g.status === "reverted") && (
				<div className="px-[12px] py-[10px] text-[10.5px] text-[var(--text-tertiary)] opacity-60">
					{session.groups.filter((g) => g.status === "reverted").length} reverted group(s) hidden
				</div>
			)}
		</div>
	);
}
