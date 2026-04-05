import { useEffect, useRef, useState } from "react";
import type { MergedTicketIssue } from "../../../shared/tickets";
import { trpc } from "../../trpc/client";

interface StatusPickerProps {
	issue: MergedTicketIssue;
	onStatusChange: (issue: MergedTicketIssue, transitionOrStateId: string) => void;
}

export function StatusPicker({ issue, onStatusChange }: StatusPickerProps) {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	// Fetch transitions/states only when open
	const { data: jiraTransitions, isLoading: jiraLoading } =
		trpc.atlassian.getIssueTransitions.useQuery(
			{ issueKey: issue.id },
			{ enabled: open && issue.provider === "jira", staleTime: 5 * 60_000 }
		);

	const { data: linearStates, isLoading: linearLoading } = trpc.linear.getTeamStates.useQuery(
		{ teamId: issue.groupId },
		{ enabled: open && issue.provider === "linear", staleTime: 5 * 60_000 }
	);

	const states = issue.provider === "jira" ? jiraTransitions : linearStates;
	const isLoading = issue.provider === "jira" ? jiraLoading : linearLoading;

	// Close on click outside
	useEffect(() => {
		if (!open) return;
		function handleClick(e: MouseEvent) {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [open]);

	return (
		<div ref={containerRef} className="relative w-[80px] shrink-0">
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setOpen((prev) => !prev);
				}}
				className={`rounded-[4px] px-1.5 py-0.5 text-[9px] transition-colors duration-[80ms] ${
					open
						? "bg-[rgba(10,132,255,0.12)] text-[var(--text-secondary)] ring-1 ring-[rgba(10,132,255,0.3)]"
						: "bg-[rgba(255,255,255,0.04)] text-[var(--text-tertiary)] hover:bg-[rgba(255,255,255,0.08)]"
				}`}
			>
				{issue.status.name}
			</button>

			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]">
					{isLoading ? (
						<div className="px-3 py-2 text-[11px] text-[var(--text-quaternary)]">Loading…</div>
					) : states && states.length > 0 ? (
						states.map((state) => (
							<button
								key={state.id}
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onStatusChange(issue, state.id);
									setOpen(false);
								}}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[var(--text-secondary)] transition-colors duration-[80ms] hover:bg-[var(--bg-overlay)]"
							>
								<span
									className="inline-block h-[6px] w-[6px] shrink-0 rounded-full"
									style={{ backgroundColor: state.color }}
								/>
								{state.name}
							</button>
						))
					) : (
						<div className="px-3 py-2 text-[11px] text-[var(--text-quaternary)]">
							No transitions available
						</div>
					)}
				</div>
			)}
		</div>
	);
}
