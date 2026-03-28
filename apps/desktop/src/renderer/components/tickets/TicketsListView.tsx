import { useState } from "react";
import type { MergedTicketIssue } from "../../../shared/tickets";
import type { StatusColumn } from "../../hooks/useTicketsData";
import { StateIcon } from "../StateIcon";
import type { LinkedWorkspace } from "../WorkspacePopover";

interface TicketsListViewProps {
	columns: StatusColumn[];
	linkedMap: Map<string, LinkedWorkspace[]>;
	selectedTicketId: string | null;
	showProvider: boolean;
	onTicketClick: (issue: MergedTicketIssue) => void;
	onTicketContextMenu: (e: React.MouseEvent, issue: MergedTicketIssue) => void;
}

function columnStateType(category: string): string {
	switch (category) {
		case "backlog":
			return "backlog";
		case "todo":
			return "unstarted";
		case "in_progress":
			return "started";
		case "done":
			return "completed";
		default:
			return "default";
	}
}

export function TicketsListView({
	columns,
	linkedMap,
	selectedTicketId,
	showProvider,
	onTicketClick,
	onTicketContextMenu,
}: TicketsListViewProps) {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const toggleGroup = (category: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(category)) next.delete(category);
			else next.add(category);
			return next;
		});
	};

	return (
		<div className="flex h-full flex-col overflow-y-auto px-3 py-2">
			{columns.map((col) => {
				const isCollapsed = collapsed.has(col.category);
				return (
					<div key={col.category}>
						<button
							type="button"
							onClick={() => toggleGroup(col.category)}
							className="flex w-full items-center gap-1.5 px-1 py-1.5 text-[9px] font-semibold uppercase tracking-[0.3px] text-[var(--text-tertiary)]"
						>
							<svg
								width="8"
								height="8"
								viewBox="0 0 10 10"
								fill="none"
								className={`shrink-0 transition-transform duration-150 ${!isCollapsed ? "rotate-90" : ""}`}
								aria-hidden="true"
							>
								<path
									d="M3 1.5L7 5L3 8.5"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							<StateIcon type={columnStateType(col.category)} color={col.color} size={8} />
							<span>{col.label}</span>
							<span className="font-normal tabular-nums opacity-50">{col.items.length}</span>
						</button>
						{!isCollapsed &&
							col.items.map((issue) => {
								const linked = linkedMap.get(`${issue.provider}:${issue.id}`);
								const isLinked = linked && linked.length > 0;
								const isSelected = selectedTicketId === issue.id;
								return (
									<button
										key={`${issue.provider}:${issue.id}`}
										type="button"
										onClick={() => onTicketClick(issue)}
										onContextMenu={(e) => onTicketContextMenu(e, issue)}
										className={`ml-4 flex w-[calc(100%-16px)] items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left transition-all duration-[120ms] ${
											isSelected
												? "bg-[rgba(10,132,255,0.08)]"
												: "hover:bg-[rgba(255,255,255,0.03)]"
										}`}
									>
										<StateIcon
											type={issue.stateType || "default"}
											color={issue.status.color}
											size={8}
										/>
										<span
											className={`w-[58px] shrink-0 text-[11px] font-medium ${
												isLinked ? "text-[var(--accent)]" : "text-[var(--text-quaternary)]"
											}`}
										>
											{issue.identifier}
										</span>
										<span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]">
											{issue.title}
										</span>
										{isLinked && (
											<span className="shrink-0 rounded-[3px] bg-[rgba(10,132,255,0.1)] px-1.5 py-px text-[9px] text-[var(--accent)]">
												linked
											</span>
										)}
										{showProvider && (
											<span className="shrink-0 text-[9px] text-[var(--text-quaternary)]">
												{issue.provider === "jira" ? "Jira" : "Linear"}
											</span>
										)}
									</button>
								);
							})}
					</div>
				);
			})}
		</div>
	);
}
