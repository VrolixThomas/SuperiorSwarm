import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSidebarBandsStore } from "../stores/sidebar-bands";
import { type BandId, clampBandHeight, computeBandLayout } from "../utils/sidebar-bands";
import { SidebarBand } from "./SidebarBand";

export interface BandDescriptor {
	id: BandId;
	title: string;
	count: number;
	onNew: () => void;
	newLabel: string;
	present: boolean;
	body: ReactNode;
}

/** Draggable resize handle. Sets the upper band's explicit height from the
 * pointer position relative to that band's top edge.
 *
 * The handle reads `previousElementSibling` to find the band it resizes. This
 * relies on the stack rendering each band and its divider as siblings inside a
 * single `display:contents` wrapper (see the map in SidebarBandStack) — the hr's
 * previous sibling is therefore the SidebarBand div. Keep that structure intact. */
function BandDivider({
	upperId,
	onResize,
}: {
	upperId: BandId;
	onResize: (id: BandId, rawHeight: number) => void;
}) {
	const ref = useRef<HTMLHRElement>(null);
	const topRef = useRef(0);
	const cleanupRef = useRef<(() => void) | null>(null);

	// Tear down any in-flight drag listeners if we unmount mid-drag.
	useEffect(() => () => cleanupRef.current?.(), []);

	const startDrag = (e: React.PointerEvent) => {
		if (!ref.current) return;
		e.preventDefault();
		const prev = ref.current.previousElementSibling as HTMLElement | null;
		topRef.current = prev ? prev.getBoundingClientRect().top : 0;
		document.body.style.cursor = "row-resize";
		const move = (ev: PointerEvent) => onResize(upperId, ev.clientY - topRef.current);
		const end = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", end);
			document.body.style.cursor = "";
			cleanupRef.current = null;
		};
		cleanupRef.current = end;
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", end);
	};

	return (
		<hr
			ref={ref}
			onPointerDown={startDrag}
			aria-orientation="horizontal"
			tabIndex={0}
			className="group relative m-0 h-[7px] shrink-0 cursor-row-resize border-0 bg-transparent p-0 outline-none before:absolute before:inset-x-0 before:top-[3px] before:block before:h-px before:bg-[var(--border-subtle)] hover:before:bg-[var(--border-active)]"
		/>
	);
}

export function SidebarBandStack({ bands }: { bands: BandDescriptor[] }) {
	const order = useSidebarBandsStore((s) => s.order);
	const open = useSidebarBandsStore((s) => s.open);
	const heights = useSidebarBandsStore((s) => s.heights);
	const hydrate = useSidebarBandsStore((s) => s.hydrate);
	const toggleOpen = useSidebarBandsStore((s) => s.toggleOpen);
	const setOrder = useSidebarBandsStore((s) => s.setOrder);
	const setHeight = useSidebarBandsStore((s) => s.setHeight);

	useEffect(() => hydrate(), [hydrate]);

	const rootRef = useRef<HTMLDivElement>(null);
	const [containerHeight, setContainerHeight] = useState(0);
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
		ro.observe(el);
		setContainerHeight(el.clientHeight);
		return () => ro.disconnect();
	}, []);

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

	const byId = new Map(bands.map((b) => [b.id, b]));
	const present = {
		folders: byId.get("folders")?.present ?? false,
		repositories: byId.get("repositories")?.present ?? false,
		orchestrators: byId.get("orchestrators")?.present ?? false,
	};

	const layout = computeBandLayout({
		order,
		present,
		open,
		heights,
		preferredFlex: "repositories",
		containerHeight: containerHeight || 600,
	});

	const rendered = order.filter((id) => present[id]);

	const onDragEnd = (e: DragEndEvent) => {
		const { active, over } = e;
		if (!over || active.id === over.id) return;
		const from = order.indexOf(active.id as BandId);
		const to = order.indexOf(over.id as BandId);
		if (from === -1 || to === -1) return;
		setOrder(arrayMove(order, from, to));
	};

	const onResize = (id: BandId, rawHeight: number) =>
		setHeight(id, clampBandHeight(rawHeight, containerHeight || 600));

	return (
		<div ref={rootRef} className="flex h-full min-h-0 flex-col">
			<DndContext sensors={sensors} onDragEnd={onDragEnd}>
				<SortableContext items={rendered} strategy={verticalListSortingStrategy}>
					{rendered.map((id, idx) => {
						const band = byId.get(id);
						if (!band) return null;
						const isLast = idx === rendered.length - 1;
						const showDivider = !isLast && open[id];
						return (
							// display:contents keeps the band+divider as flex siblings of the
							// stack while remaining DOM siblings — BandDivider relies on this.
							<div key={id} className="contents">
								<SidebarBand
									id={id}
									title={band.title}
									count={band.count}
									onNew={band.onNew}
									newLabel={band.newLabel}
									isOpen={open[id]}
									onToggleOpen={() => toggleOpen(id)}
									style={layout[id]}
								>
									{band.body}
								</SidebarBand>
								{showDivider && <BandDivider upperId={id} onResize={onResize} />}
							</div>
						);
					})}
				</SortableContext>
			</DndContext>
		</div>
	);
}
