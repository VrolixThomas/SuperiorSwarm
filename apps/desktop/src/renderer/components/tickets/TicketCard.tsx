import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo } from "react";
import type { MergedTicketIssue } from "../../../shared/tickets";
import { useAssigneePickerStore } from "../../stores/assignee-picker-store";
import { StateIcon } from "../StateIcon";
import type { LinkedWorkspace } from "../WorkspacePopover";
import { AssigneeAvatar } from "./AssigneeAvatar";

interface TicketCardProps {
	issue: MergedTicketIssue;
	isSelected: boolean;
	linked: LinkedWorkspace[] | undefined;
	showProvider: boolean;
	isDragOverlay?: boolean;
	onClick: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
}

function TicketCardImpl({
	issue,
	isSelected,
	linked,
	showProvider,
	isDragOverlay,
	onClick,
	onContextMenu,
}: TicketCardProps) {
	const openPicker = useAssigneePickerStore((s) => s.openFor);
	const sortableId = `${issue.provider}:${issue.id}`;
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: sortableId,
		disabled: isDragOverlay,
	});

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.3 : 1,
	};

	const isLinked = linked && linked.length > 0;

	let borderClass: string;
	if (isSelected) {
		borderClass = "border-[rgba(10,132,255,0.3)] bg-[#1a1a1c]";
	} else if (isLinked) {
		borderClass = "border-[rgba(10,132,255,0.12)] bg-[#111] hover:bg-[#161618]";
	} else {
		borderClass = "border-[rgba(255,255,255,0.03)] bg-[#111] hover:bg-[#161618]";
	}

	if (isDragOverlay) {
		borderClass = "border-[rgba(10,132,255,0.3)] bg-[#1a1a1c] shadow-lg";
	}

	return (
		<button
			ref={isDragOverlay ? undefined : setNodeRef}
			style={isDragOverlay ? { transform: "scale(1.02)" } : style}
			type="button"
			onClick={onClick}
			onContextMenu={onContextMenu}
			className={`relative flex w-full flex-col gap-1 rounded-[6px] border px-2.5 py-2 text-left transition-all duration-[120ms] ${borderClass}`}
			{...(isDragOverlay ? {} : attributes)}
			{...(isDragOverlay ? {} : listeners)}
		>
			{isSelected && !isDragOverlay && (
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
					<span className="rounded-[3px] bg-[rgba(10,132,255,0.1)] px-1.5 py-px text-[8px] text-[var(--accent)]">
						linked
					</span>
				)}
				{showProvider && !isLinked && (
					<span className="text-[8px] text-[var(--text-quaternary)] opacity-60">
						{issue.provider === "jira" ? "Jira" : "Linear"}
					</span>
				)}
				<span className="ml-auto">
					<AssigneeAvatar
						assigneeId={issue.assigneeId}
						assigneeName={issue.assigneeName}
						size={16}
						onClick={(e) => {
							e.stopPropagation();
							openPicker(issue, { x: e.clientX, y: e.clientY });
						}}
					/>
				</span>
			</div>
			<span className="line-clamp-2 text-[11px] leading-[1.35] text-[var(--text)]">
				{issue.title}
			</span>
		</button>
	);
}

// Every 5s poll rebuilds the allIssues array → all `issue` object refs are new even when
// nothing meaningful changed. Default shallow compare can't see through that; compare only
// the fields we actually render.
function areTicketCardPropsEqual(prev: TicketCardProps, next: TicketCardProps): boolean {
	if (prev.isSelected !== next.isSelected) return false;
	if (prev.showProvider !== next.showProvider) return false;
	if (prev.isDragOverlay !== next.isDragOverlay) return false;
	if (prev.onClick !== next.onClick) return false;
	if (prev.onContextMenu !== next.onContextMenu) return false;

	const prevLinkedLen = prev.linked?.length ?? 0;
	const nextLinkedLen = next.linked?.length ?? 0;
	if (prevLinkedLen !== nextLinkedLen) return false;

	const a = prev.issue;
	const b = next.issue;
	return (
		a.id === b.id &&
		a.provider === b.provider &&
		a.identifier === b.identifier &&
		a.title === b.title &&
		a.status.color === b.status.color &&
		a.stateType === b.stateType &&
		a.assigneeId === b.assigneeId &&
		a.assigneeName === b.assigneeName &&
		a.updatedAt === b.updatedAt
	);
}

export const TicketCard = memo(TicketCardImpl, areTicketCardPropsEqual);
