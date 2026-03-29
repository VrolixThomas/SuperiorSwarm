import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { MergedTicketIssue } from "../../../shared/tickets";
import { columnStateType } from "../../../shared/tickets";
import type { useTicketDragDrop } from "../../hooks/useTicketDragDrop";
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
	dnd: ReturnType<typeof useTicketDragDrop>;
}

function DroppableColumn({
	col,
	linkedMap,
	selectedTicketId,
	showProvider,
	onTicketClick,
	onTicketContextMenu,
}: {
	col: StatusColumn;
	linkedMap: Map<string, LinkedWorkspace[]>;
	selectedTicketId: string | null;
	showProvider: boolean;
	onTicketClick: (issue: MergedTicketIssue) => void;
	onTicketContextMenu: (e: React.MouseEvent, issue: MergedTicketIssue) => void;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: col.category });
	const sortableIds = col.items.map((issue) => `${issue.provider}:${issue.id}`);

	return (
		<div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
			<div className="flex items-center gap-1.5 px-1 py-1 text-[9px] font-semibold uppercase tracking-[0.3px] text-[var(--text-tertiary)]">
				<StateIcon type={columnStateType(col.category)} color={col.color} size={8} />
				<span>{col.label}</span>
				<span className="ml-auto font-normal tabular-nums opacity-50">{col.items.length}</span>
			</div>
			<SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
				<div
					ref={setNodeRef}
					className={`flex flex-1 flex-col gap-1.5 overflow-y-auto rounded-[6px] border border-transparent transition-colors duration-150 ${
						isOver ? "border-[rgba(10,132,255,0.2)] bg-[rgba(10,132,255,0.03)]" : ""
					}`}
				>
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
			</SortableContext>
		</div>
	);
}

export function TicketsBoardView({
	columns,
	linkedMap,
	selectedTicketId,
	showProvider,
	onTicketClick,
	onTicketContextMenu,
	dnd,
}: TicketsBoardViewProps) {
	return (
		<DndContext
			sensors={dnd.sensors}
			collisionDetection={dnd.collisionDetection}
			onDragStart={dnd.handleDragStart}
			onDragEnd={dnd.handleDragEnd}
			onDragCancel={dnd.handleDragCancel}
		>
			<div className="flex h-full gap-2.5 overflow-x-auto px-3 py-2">
				{columns.map((col) => (
					<DroppableColumn
						key={col.category}
						col={col}
						linkedMap={linkedMap}
						selectedTicketId={selectedTicketId}
						showProvider={showProvider}
						onTicketClick={onTicketClick}
						onTicketContextMenu={onTicketContextMenu}
					/>
				))}
			</div>

			<DragOverlay dropAnimation={null}>
				{dnd.activeIssue ? (
					<TicketCard
						issue={dnd.activeIssue}
						isSelected={false}
						linked={linkedMap.get(`${dnd.activeIssue.provider}:${dnd.activeIssue.id}`)}
						showProvider={showProvider}
						isDragOverlay
						onClick={() => {}}
						onContextMenu={() => {}}
					/>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
