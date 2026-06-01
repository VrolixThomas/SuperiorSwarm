import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projects";
import { clampPaneHeight } from "../utils/sidebar-split";

const LS_HEIGHT = "ss.sidebar.orchHeight";
const LS_COLLAPSED = "ss.sidebar.orchCollapsed";

/**
 * Vertical split for the Repos segment: `top` (repo tree) flexes and scrolls;
 * a draggable divider resizes the `bottom` pane (orchestrators); the bottom
 * pane can collapse to just its own header (the header lives inside `bottom`).
 * Height + collapsed state persist to localStorage.
 */
export function SidebarSplit({ top, bottom }: { top: ReactNode; bottom: ReactNode }) {
	const rootRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);

	const height = useProjectStore((s) => s.orchestratorPaneHeight);
	const collapsed = useProjectStore((s) => s.orchestratorPaneCollapsed);
	const setHeight = useProjectStore((s) => s.setOrchestratorPaneHeight);
	const setCollapsed = useProjectStore((s) => s.setOrchestratorPaneCollapsed);

	// Hydrate from localStorage once on mount.
	useEffect(() => {
		try {
			const h = window.localStorage.getItem(LS_HEIGHT);
			if (h !== null) setHeight(Number.parseInt(h, 10) || 180);
			const c = window.localStorage.getItem(LS_COLLAPSED);
			if (c !== null) setCollapsed(c === "true");
		} catch {}
	}, [setHeight, setCollapsed]);

	// Persist collapsed state immediately on change.
	useEffect(() => {
		try {
			window.localStorage.setItem(LS_COLLAPSED, String(collapsed));
		} catch {}
	}, [collapsed]);

	const onPointerMove = useCallback(
		(e: PointerEvent) => {
			if (!draggingRef.current || !rootRef.current) return;
			const rect = rootRef.current.getBoundingClientRect();
			setHeight(clampPaneHeight(rect.bottom - e.clientY, rect.height));
		},
		[setHeight]
	);

	const endDrag = useCallback(() => {
		draggingRef.current = false;
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", endDrag);
		window.removeEventListener("pointercancel", endDrag);
		document.body.style.cursor = "";
		try {
			window.localStorage.setItem(
				LS_HEIGHT,
				String(useProjectStore.getState().orchestratorPaneHeight)
			);
		} catch {}
	}, [onPointerMove]);

	const startDrag = useCallback(
		(e: React.PointerEvent) => {
			if (collapsed) return;
			e.preventDefault();
			draggingRef.current = true;
			document.body.style.cursor = "row-resize";
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", endDrag);
			window.addEventListener("pointercancel", endDrag);
		},
		[collapsed, onPointerMove, endDrag]
	);

	useEffect(() => endDrag, [endDrag]);

	return (
		<div ref={rootRef} className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto">{top}</div>

			<hr
				className="group relative m-0 h-[7px] shrink-0 cursor-row-resize border-0 bg-transparent p-0 outline-none before:absolute before:inset-x-0 before:top-[3px] before:block before:h-px before:bg-[var(--border-subtle)] hover:before:bg-[var(--border-active)]"
				onPointerDown={startDrag}
				aria-orientation="horizontal"
				tabIndex={0}
			/>

			<div
				className="flex min-h-0 shrink-0 flex-col"
				style={{ height: collapsed ? "auto" : `${height}px` }}
			>
				{bottom}
			</div>
		</div>
	);
}
