import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssigneeFilterValue } from "../../../shared/tickets";
import {
	UNASSIGNED_FILTER_KEY,
	computeNextAssigneeFilter,
	serializeAssigneeFilter,
} from "../../../shared/tickets";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { useTicketsData } from "../../hooks/useTicketsData";
import { trpc } from "../../trpc/client";
import { AssigneeAvatar } from "./AssigneeAvatar";

const UNASSIGNED_KEY = UNASSIGNED_FILTER_KEY;

export function AssigneeFilter() {
	const {
		teamMembers: members,
		currentLinearUserId,
		currentJiraUserId,
		assigneeFilter: value,
		projectId,
	} = useTicketsData();
	const utils = trpc.useUtils();
	const setFilter = trpc.tickets.setAssigneeFilter.useMutation();
	const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingRef = useRef<AssigneeFilterValue | null>(null);

	// No onSuccess invalidate: the optimistic setData below already writes the server's
	// eventual value; refetching mid-typing would clobber pending user input.
	const flush = useCallback(() => {
		if (flushTimer.current) {
			clearTimeout(flushTimer.current);
			flushTimer.current = null;
		}
		if (pendingRef.current === null) return;
		const next = pendingRef.current;
		pendingRef.current = null;
		setFilter.mutate({ projectId, value: serializeAssigneeFilter(next) });
	}, [projectId, setFilter]);

	const onChange = useCallback(
		(next: AssigneeFilterValue) => {
			// Optimistic cache update — UI reflects intent immediately.
			utils.tickets.getAssigneeFilter.setData({ projectId }, serializeAssigneeFilter(next));

			pendingRef.current = next;
			if (flushTimer.current) clearTimeout(flushTimer.current);
			flushTimer.current = setTimeout(flush, 300);
		},
		[projectId, utils, flush]
	);

	// Flush on unmount so a pending write lands even if the component is removed.
	useEffect(() => {
		return () => {
			flush();
		};
	}, [flush]);

	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const close = useCallback(() => {
		flush();
		setOpen(false);
	}, [flush]);
	useClickOutside(ref, close, open);
	useEscapeKey(close, open);

	const meIds = useMemo(
		() => [currentLinearUserId, currentJiraUserId].filter((id): id is string => id !== null),
		[currentLinearUserId, currentJiraUserId]
	);

	const checkedIds = useMemo(() => {
		if (value === "all") return null;
		if (value === "me") {
			return new Set(meIds);
		}
		return new Set(value.userIds);
	}, [value, meIds]);

	const unassignedChecked =
		value === "all" ? true : typeof value === "object" ? value.includeUnassigned : false;

	const isChecked = useCallback(
		(key: string): boolean => {
			if (key === UNASSIGNED_KEY) return unassignedChecked;
			if (checkedIds === null) return true;
			return checkedIds.has(key);
		},
		[checkedIds, unassignedChecked]
	);

	const onToggle = useCallback(
		(key: string) => {
			onChange(computeNextAssigneeFilter(value, key, meIds));
		},
		[value, onChange, meIds]
	);

	const isObjectMode = typeof value === "object";

	const selectedMembers = useMemo(
		() =>
			members.filter(
				(m) => isObjectMode && (value as { userIds: string[] }).userIds.includes(m.id)
			),
		[members, isObjectMode, value]
	);

	const triggerLabel = useMemo(() => {
		if (value === "all") return "All";
		if (value === "me") return "Me";
		// object mode
		if (value.userIds.length === 1) {
			const member = members.find((m) => m.id === value.userIds[0]);
			if (member) {
				return member.name.split(" ")[0] ?? member.name;
			}
		}
		const count = value.userIds.length + (value.includeUnassigned ? 1 : 0);
		return `${count} selected`;
	}, [value, members]);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1.5 rounded-[5px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
			>
				{isObjectMode && selectedMembers.length > 0 ? (
					<span className="flex items-center">
						{selectedMembers.slice(0, 2).map((m, i) => (
							<span
								key={m.id}
								style={{ marginLeft: i > 0 ? -4 : 0, position: "relative", zIndex: 2 - i }}
							>
								<AssigneeAvatar assigneeId={m.id} assigneeName={m.name} size={12} />
							</span>
						))}
						{selectedMembers.length > 2 && (
							<span
								className="flex h-[12px] w-[12px] items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[7px] text-[var(--text-quaternary)]"
								style={{
									marginLeft: -4,
									position: "relative",
									zIndex: 0,
									border: "1px solid rgba(255,255,255,0.1)",
								}}
							>
								+{selectedMembers.length - 2}
							</span>
						)}
					</span>
				) : (
					<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3" />
						<path
							d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
						/>
					</svg>
				)}
				{triggerLabel}
				<svg
					width="8"
					height="8"
					viewBox="0 0 8 8"
					fill="none"
					aria-hidden="true"
					style={{
						transform: open ? "rotate(180deg)" : "rotate(0deg)",
						transition: "transform 0.15s",
					}}
				>
					<path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1" fill="none" />
				</svg>
			</button>

			{open && (
				<div
					className="absolute left-0 top-full z-50 mt-1 w-[210px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg-overlay)] shadow-xl"
					style={{ animation: "assigneeFilterIn 0.1s ease-out" }}
				>
					{/* Preset buttons section */}
					<div className="p-1">
						<button
							type="button"
							onClick={() => {
								onChange("all");
								setOpen(false);
							}}
							className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[11px] transition-colors ${value === "all" ? "bg-[rgba(10,132,255,0.08)] font-medium text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}
						>
							{/* "All people" group icon */}
							<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
								<circle cx="5.5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
								<circle cx="10.5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
								<path
									d="M1 13c0-2.5 2-4.5 4.5-4.5"
									stroke="currentColor"
									strokeWidth="1.2"
									strokeLinecap="round"
								/>
								<path
									d="M15 13c0-2.5-2-4.5-4.5-4.5"
									stroke="currentColor"
									strokeWidth="1.2"
									strokeLinecap="round"
								/>
							</svg>
							All people
						</button>
						{typeof value !== "object" && (
							<button
								type="button"
								onClick={() => {
									onChange("me");
									setOpen(false);
								}}
								className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[11px] transition-colors ${value === "me" ? "bg-[rgba(10,132,255,0.08)] font-medium text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}
							>
								{/* Person icon */}
								<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
									<circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.2" />
									<path
										d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"
										stroke="currentColor"
										strokeWidth="1.2"
										strokeLinecap="round"
									/>
								</svg>
								Just me
							</button>
						)}
					</div>

					<div className="mx-1 h-px bg-[var(--border-subtle)]" />

					{/* Members list (scrollable) */}
					<div className="max-h-[220px] overflow-y-auto p-1">
						{/* Unassigned row */}
						<button
							type="button"
							onClick={() => onToggle(UNASSIGNED_KEY)}
							className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[11px] transition-colors ${isObjectMode && unassignedChecked ? "bg-[rgba(10,132,255,0.06)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}
						>
							<span
								className="flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-full text-[7px] text-[var(--text-quaternary)]"
								style={{ border: "1px dashed rgba(255,255,255,0.2)" }}
							>
								—
							</span>
							<span className="flex-1">Unassigned</span>
							{isObjectMode && unassignedChecked && (
								<svg width="10" height="10" viewBox="0 0 12 12" fill="none">
									<path
										d="M2 6l3 3 5-5"
										stroke="rgba(10,132,255,0.8)"
										strokeWidth="1.3"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							)}
						</button>

						{/* Member rows */}
						{members.map((m) => {
							const checked = isObjectMode && isChecked(m.id);
							return (
								<button
									key={m.id}
									type="button"
									onClick={() => onToggle(m.id)}
									className={`flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[11px] transition-colors ${checked ? "bg-[rgba(10,132,255,0.06)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}
								>
									<AssigneeAvatar assigneeId={m.id} assigneeName={m.name} size={16} />
									<span className="flex-1 truncate">
										{meIds.includes(m.id) ? `${m.name} (me)` : m.name}
									</span>
									{checked && (
										<svg
											width="10"
											height="10"
											viewBox="0 0 12 12"
											fill="none"
											className="flex-shrink-0"
										>
											<path
												d="M2 6l3 3 5-5"
												stroke="rgba(10,132,255,0.8)"
												strokeWidth="1.3"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									)}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
