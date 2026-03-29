import type { MergedTicketIssue } from "../../../shared/tickets";
import { StateIcon } from "../StateIcon";
import type { LinkedWorkspace } from "../WorkspacePopover";

interface TicketCardProps {
	issue: MergedTicketIssue;
	isSelected: boolean;
	linked: LinkedWorkspace[] | undefined;
	showProvider: boolean;
	onClick: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
}

export function TicketCard({
	issue,
	isSelected,
	linked,
	showProvider,
	onClick,
	onContextMenu,
}: TicketCardProps) {
	const isLinked = linked && linked.length > 0;

	let borderClass: string;
	if (isSelected) {
		borderClass = "border-[rgba(10,132,255,0.3)] bg-[#1a1a1c]";
	} else if (isLinked) {
		borderClass = "border-[rgba(10,132,255,0.12)] bg-[#111] hover:bg-[#161618]";
	} else {
		borderClass = "border-[rgba(255,255,255,0.03)] bg-[#111] hover:bg-[#161618]";
	}

	return (
		<button
			type="button"
			onClick={onClick}
			onContextMenu={onContextMenu}
			className={`relative flex w-full flex-col gap-1 rounded-[6px] border px-2.5 py-2 text-left transition-all duration-[120ms] ${borderClass}`}
		>
			{isSelected && (
				<div className="absolute bottom-1 left-[-1px] top-1 w-[2px] rounded-[1px] bg-[var(--accent)]" />
			)}
			<div className="flex items-center gap-1.5">
				<StateIcon type={issue.stateType || "default"} color={issue.status.color} size={10} />
				<span
					className={`text-[10px] font-medium ${isLinked ? "text-[var(--accent)]" : "text-[var(--text-quaternary)]"}`}
				>
					{issue.identifier}
				</span>
				{isLinked && (
					<span className="ml-auto rounded-[3px] bg-[rgba(10,132,255,0.1)] px-1.5 py-px text-[8px] text-[var(--accent)]">
						linked
					</span>
				)}
				{showProvider && !isLinked && (
					<span className="ml-auto text-[8px] text-[var(--text-quaternary)] opacity-60">
						{issue.provider === "jira" ? "Jira" : "Linear"}
					</span>
				)}
			</div>
			<span className="line-clamp-2 text-[11px] leading-[1.35] text-[var(--text)]">
				{issue.title}
			</span>
		</button>
	);
}
