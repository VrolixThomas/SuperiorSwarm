import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import type { BandId, BandStyle } from "../utils/sidebar-bands";
import { SidebarSectionHeader } from "./SidebarSectionHeader";

const BODY_CLASS = "flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2";

/** Outer sizing classes per resolved style (collapsed/hidden handled by caller). */
function sizingClass(style: BandStyle): string {
	switch (style.kind) {
		case "flex":
			return "flex min-h-0 flex-1 flex-col";
		case "fixed":
			return "flex min-h-0 shrink-0 flex-col";
		case "auto":
			return "flex max-h-[40%] shrink-0 flex-col";
		default:
			// collapsed: header only, no body
			return "flex shrink-0 flex-col";
	}
}

export function SidebarBand({
	id,
	title,
	count,
	onNew,
	newLabel,
	isOpen,
	onToggleOpen,
	style,
	children,
}: {
	id: BandId;
	title: string;
	count: number;
	onNew: () => void;
	newLabel: string;
	isOpen: boolean;
	onToggleOpen: () => void;
	style: BandStyle;
	children: ReactNode;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id,
	});

	const heightStyle = style.kind === "fixed" ? { height: `${style.heightPx}px` } : undefined;

	return (
		<div
			ref={setNodeRef}
			className={`border-b border-[var(--border-subtle)] ${sizingClass(style)}`}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				zIndex: isDragging ? 20 : undefined,
				opacity: isDragging ? 0.85 : 1,
				...heightStyle,
			}}
		>
			<SidebarSectionHeader
				title={title}
				count={count}
				onNew={onNew}
				newLabel={newLabel}
				onToggle={onToggleOpen}
				expanded={isOpen}
				className="shrink-0 bg-[var(--bg-surface)]"
				dragHandle={{ attributes, listeners }}
			/>
			{isOpen && <div className={BODY_CLASS}>{children}</div>}
		</div>
	);
}
