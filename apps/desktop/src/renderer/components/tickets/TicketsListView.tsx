import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo, useState } from "react";
import type { MergedTicketIssue } from "../../../shared/tickets";
import { columnStateType } from "../../../shared/tickets";
import type { useTicketDragDrop } from "../../hooks/useTicketDragDrop";
import type { StatusColumn } from "../../hooks/useTicketsData";
import { useAssigneePickerStore } from "../../stores/assignee-picker-store";
import { StateIcon } from "../StateIcon";
import type { LinkedWorkspace } from "../WorkspacePopover";
import { AssigneeAvatar } from "./AssigneeAvatar";

interface TicketsListViewProps {
	columns: StatusColumn[];
	linkedMap: Map<string, LinkedWorkspace[]>;
	selectedTicketId: string | null;
	showProvider: boolean;
	onTicketClick: (issue: MergedTicketIssue) => void;
	onTicketContextMenu: (e: React.MouseEvent, issue: MergedTicketIssue) => void;
	dnd: ReturnType<typeof useTicketDragDrop>;
}

interface SortableListRowProps {
	issue: MergedTicketIssue;
	isSelected: boolean;
	isLinked: boolean;
	showProvider: boolean;
	isDragOverlay?: boolean;
	onClick: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
}

function SortableListRowImpl({
	issue,
	isSelected,
	isLinked,
	showProvider,
	isDragOverlay,
	onClick,
	onContextMenu,
}: SortableListRowProps) {
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

	let rowClass: string;
	if (isDragOverlay) {
		rowClass = "bg-[#1a1a1c] shadow-lg ring-1 ring-[rgba(10,132,255,0.3)]";
	} else if (isSelected) {
		rowClass = "bg-[rgba(10,132,255,0.08)]";
	} else {
		rowClass = "hover:bg-[rgba(255,255,255,0.03)]";
	}

	return (
		<button
			ref={isDragOverlay ? undefined : setNodeRef}
			style={isDragOverlay ? undefined : style}
			type="button"
			onClick={onClick}
			onContextMenu={onContextMenu}
			className={`ml-4 flex w-[calc(100%-16px)] items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left transition-all duration-[120ms] ${rowClass}`}
			{...(isDragOverlay ? {} : attributes)}
			{...(isDragOverlay ? {} : listeners)}
		>
			<StateIcon type={issue.stateType || "default"} color={issue.status.color} size={8} />
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
			<AssigneeAvatar
				assigneeId={issue.assigneeId}
				assigneeName={issue.assigneeName}
				size={14}
				onClick={(e) => {
					e.stopPropagation();
					openPicker(issue, { x: e.clientX, y: e.clientY });
				}}
			/>
		</button>
	);
}

const SortableListRow = memo(SortableListRowImpl);

function DroppableGroup({
	col,
	isCollapsed,
	onToggle,
	linkedMap,
	selectedTicketId,
	showProvider,
	onTicketClick,
	onTicketContextMenu,
}: {
	col: StatusColumn;
	isCollapsed: boolean;
	onToggle: () => void;
	linkedMap: Map<string, LinkedWorkspace[]>;
	selectedTicketId: string | null;
	showProvider: boolean;
	onTicketClick: (issue: MergedTicketIssue) => void;
	onTicketContextMenu: (e: React.MouseEvent, issue: MergedTicketIssue) => void;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: col.category });
	const sortableIds = col.items.map((issue) => `${issue.provider}:${issue.id}`);

	return (
		<div
			ref={setNodeRef}
			className={`rounded-[6px] border border-transparent transition-colors duration-150 ${
				isOver ? "border-[rgba(10,132,255,0.2)] bg-[rgba(10,132,255,0.03)]" : ""
			}`}
		>
			<button
				type="button"
				onClick={onToggle}
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
			{!isCollapsed && (
				<SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
					<div>
						{col.items.map((issue) => {
							const linked = linkedMap.get(`${issue.provider}:${issue.id}`);
							const isLinked = !!(linked && linked.length > 0);
							return (
								<SortableListRow
									key={`${issue.provider}:${issue.id}`}
									issue={issue}
									isSelected={selectedTicketId === issue.id}
									isLinked={isLinked}
									showProvider={showProvider}
									onClick={() => onTicketClick(issue)}
									onContextMenu={(e) => onTicketContextMenu(e, issue)}
								/>
							);
						})}
					</div>
				</SortableContext>
			)}
		</div>
	);
}

export function TicketsListView({
	columns,
	linkedMap,
	selectedTicketId,
	showProvider,
	onTicketClick,
	onTicketContextMenu,
	dnd,
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
		<DndContext
			sensors={dnd.sensors}
			collisionDetection={dnd.collisionDetection}
			onDragStart={dnd.handleDragStart}
			onDragEnd={dnd.handleDragEnd}
			onDragCancel={dnd.handleDragCancel}
		>
			<div className="flex h-full flex-col overflow-y-auto px-3 py-2">
				{columns.map((col) => (
					<DroppableGroup
						key={col.category}
						col={col}
						isCollapsed={collapsed.has(col.category)}
						onToggle={() => toggleGroup(col.category)}
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
					<SortableListRow
						issue={dnd.activeIssue}
						isSelected={false}
						isLinked={!!linkedMap.get(`${dnd.activeIssue.provider}:${dnd.activeIssue.id}`)?.length}
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
