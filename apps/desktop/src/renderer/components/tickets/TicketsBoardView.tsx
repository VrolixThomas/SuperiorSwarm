import type { MergedTicketIssue } from "../../../shared/tickets";
import type { StatusColumn } from "../../hooks/useTicketsData";
import { StateIcon } from "../StateIcon";
import type { LinkedWorkspace } from "../WorkspacePopover";
import { TicketCard } from "./TicketCard";

interface TicketsBoardViewProps {
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

export function TicketsBoardView({
	columns,
	linkedMap,
	selectedTicketId,
	showProvider,
	onTicketClick,
	onTicketContextMenu,
}: TicketsBoardViewProps) {
	return (
		<div className="flex h-full gap-2.5 overflow-x-auto px-3 py-2">
			{columns.map((col) => (
				<div key={col.category} className="flex min-w-[200px] flex-1 flex-col gap-1.5">
					<div className="flex items-center gap-1.5 px-1 py-1 text-[9px] font-semibold uppercase tracking-[0.3px] text-[var(--text-tertiary)]">
						<StateIcon type={columnStateType(col.category)} color={col.color} size={8} />
						<span>{col.label}</span>
						<span className="ml-auto font-normal tabular-nums opacity-50">{col.items.length}</span>
					</div>
					<div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
						{col.items.map((issue) => (
							<TicketCard
								key={`${issue.provider}:${issue.id}`}
								issue={issue}
								isSelected={selectedTicketId === issue.id}
								linked={linkedMap.get(`${issue.provider}:${issue.id}`)}
								showProvider={showProvider}
								onClick={() => onTicketClick(issue)}
								onContextMenu={(e) => onTicketContextMenu(e, issue)}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
