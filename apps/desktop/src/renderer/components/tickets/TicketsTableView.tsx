import { useMemo, useState } from "react";
import type { MergedTicketIssue, NormalizedStatusCategory } from "../../../shared/tickets";
import { formatRelativeTime, normalizeStatusCategory } from "../../../shared/tickets";
import { StateIcon } from "../StateIcon";
import type { LinkedWorkspace } from "../WorkspacePopover";

type SortField = "identifier" | "title" | "status" | "project" | "provider" | "updatedAt";
type SortDirection = "asc" | "desc";

interface TicketsTableViewProps {
	issues: MergedTicketIssue[];
	linkedMap: Map<string, LinkedWorkspace[]>;
	selectedTicketId: string | null;
	onTicketClick: (issue: MergedTicketIssue) => void;
	onTicketContextMenu: (e: React.MouseEvent, issue: MergedTicketIssue) => void;
}

const STATUS_RANK: Record<NormalizedStatusCategory, number> = {
	in_progress: 0,
	todo: 1,
	backlog: 2,
	done: 3,
};

export function TicketsTableView({
	issues,
	linkedMap,
	selectedTicketId,
	onTicketClick,
	onTicketContextMenu,
}: TicketsTableViewProps) {
	const [sortField, setSortField] = useState<SortField>("status");
	const [sortDir, setSortDir] = useState<SortDirection>("asc");

	const toggleSort = (field: SortField) => {
		if (sortField === field) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortField(field);
			setSortDir("asc");
		}
	};

	const sorted = useMemo(() => {
		const arr = [...issues];
		const dir = sortDir === "asc" ? 1 : -1;
		arr.sort((a, b) => {
			switch (sortField) {
				case "identifier":
					return dir * a.identifier.localeCompare(b.identifier);
				case "title":
					return dir * a.title.localeCompare(b.title);
				case "status": {
					const catA = normalizeStatusCategory(a.provider, a.statusCategory, a.stateType);
					const catB = normalizeStatusCategory(b.provider, b.statusCategory, b.stateType);
					return dir * (STATUS_RANK[catA] - STATUS_RANK[catB]);
				}
				case "project":
					return dir * a.groupId.localeCompare(b.groupId);
				case "provider":
					return dir * a.provider.localeCompare(b.provider);
				case "updatedAt":
					return dir * (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
				default:
					return 0;
			}
		});
		return arr;
	}, [issues, sortField, sortDir]);

	const headerClass =
		"text-[10px] font-semibold uppercase tracking-[0.3px] text-[var(--text-quaternary)] cursor-pointer select-none";
	const arrow = (field: SortField) =>
		sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";

	return (
		<div className="flex h-full flex-col overflow-y-auto">
			<div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-[var(--border)] bg-[var(--bg-base)] px-4 py-2">
				<span className="w-[14px]" />
				<button
					type="button"
					className={`w-[62px] text-left ${headerClass}`}
					onClick={() => toggleSort("identifier")}
				>
					ID{arrow("identifier")}
				</button>
				<button
					type="button"
					className={`min-w-0 flex-1 text-left ${headerClass}`}
					onClick={() => toggleSort("title")}
				>
					Title{arrow("title")}
				</button>
				<button
					type="button"
					className={`w-[80px] text-left ${headerClass}`}
					onClick={() => toggleSort("status")}
				>
					Status{arrow("status")}
				</button>
				<button
					type="button"
					className={`w-[50px] text-left ${headerClass}`}
					onClick={() => toggleSort("project")}
				>
					Project{arrow("project")}
				</button>
				<button
					type="button"
					className={`w-[44px] text-left ${headerClass}`}
					onClick={() => toggleSort("provider")}
				>
					Source{arrow("provider")}
				</button>
				<button
					type="button"
					className={`w-[60px] text-left ${headerClass}`}
					onClick={() => toggleSort("updatedAt")}
				>
					Updated{arrow("updatedAt")}
				</button>
			</div>
			{sorted.map((issue) => {
				const linked = linkedMap.get(`${issue.provider}:${issue.id}`);
				const isLinked = linked && linked.length > 0;
				const isSelected = selectedTicketId === issue.id;
				return (
					<button
						key={`${issue.provider}:${issue.id}`}
						type="button"
						onClick={() => onTicketClick(issue)}
						onContextMenu={(e) => onTicketContextMenu(e, issue)}
						className={`flex items-center gap-2.5 border-b border-[rgba(255,255,255,0.02)] px-4 py-1.5 text-left transition-colors duration-[80ms] ${
							isSelected ? "bg-[rgba(10,132,255,0.08)]" : "hover:bg-[rgba(255,255,255,0.02)]"
						}`}
					>
						<StateIcon type={issue.stateType || "default"} color={issue.status.color} size={8} />
						<span
							className={`w-[62px] shrink-0 text-[11px] font-medium ${
								isLinked ? "text-[var(--accent)]" : "text-[var(--text-quaternary)]"
							}`}
						>
							{issue.identifier}
						</span>
						<span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]">
							{issue.title}
						</span>
						<span className="w-[80px] shrink-0">
							<span className="rounded-[4px] bg-[rgba(255,255,255,0.04)] px-1.5 py-0.5 text-[9px] text-[var(--text-tertiary)]">
								{issue.status.name}
							</span>
						</span>
						<span className="w-[50px] shrink-0 text-[10px] text-[var(--text-tertiary)]">
							{issue.teamName || issue.projectKey || issue.groupId}
						</span>
						<span className="w-[44px] shrink-0 text-[10px] text-[var(--text-quaternary)]">
							{issue.provider === "jira" ? "Jira" : "Linear"}
						</span>
						<span className="w-[60px] shrink-0 text-[10px] text-[var(--text-quaternary)]">
							{formatRelativeTime(issue.updatedAt)}
						</span>
					</button>
				);
			})}
		</div>
	);
}
