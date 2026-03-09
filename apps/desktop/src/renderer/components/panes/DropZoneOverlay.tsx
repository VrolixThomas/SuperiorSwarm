import { useCallback, useState } from "react";

export type DropZone = "left" | "right" | "top" | "bottom" | "center";

/** MIME type used for tab drag-and-drop data. */
export const TAB_DRAG_MIME = "application/x-branchflux-tab";

export function DropZoneOverlay({
	paneId,
	onDrop,
}: {
	paneId: string;
	onDrop: (zone: DropZone, tabId: string, sourcePaneId: string) => void;
}) {
	const [activeZone, setActiveZone] = useState<DropZone | null>(null);

	const handleDragOver = useCallback((e: React.DragEvent, zone: DropZone) => {
		if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		setActiveZone(zone);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		// Only clear if we're leaving the overlay entirely, not just
		// moving between zones. relatedTarget === null means leaving the
		// window; otherwise check if still within the overlay wrapper.
		const related = e.relatedTarget as HTMLElement | null;
		if (!related || !e.currentTarget.contains(related)) {
			setActiveZone(null);
		}
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent, zone: DropZone) => {
			e.preventDefault();
			setActiveZone(null);

			const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
			if (!raw) return;

			try {
				const data = JSON.parse(raw) as { tabId: string; sourcePaneId: string };
				if (!data?.tabId || !data?.sourcePaneId) return;
				// Don't drop on the same pane's center — that's a no-op
				if (zone === "center" && data.sourcePaneId === paneId) return;
				onDrop(zone, data.tabId, data.sourcePaneId);
			} catch {
				// invalid data — ignore
			}
		},
		[paneId, onDrop]
	);

	const zoneClass = (zone: DropZone) =>
		activeZone === zone
			? zone === "center"
				? "drop-zone-center-highlight"
				: "drop-zone-highlight"
			: "";

	return (
		<div
			className="pointer-events-none absolute inset-0 z-50 grid"
			style={{
				gridTemplateColumns: "25% 50% 25%",
				gridTemplateRows: "25% 50% 25%",
			}}
			onDragLeave={handleDragLeave}
		>
			{/* Top zone — spans all 3 columns in first row */}
			<div
				className={`pointer-events-auto col-span-3 m-1 rounded ${zoneClass("top")}`}
				onDragOver={(e) => handleDragOver(e, "top")}
				onDrop={(e) => handleDrop(e, "top")}
			/>

			{/* Left zone — first column, middle row */}
			<div
				className={`pointer-events-auto m-1 rounded ${zoneClass("left")}`}
				onDragOver={(e) => handleDragOver(e, "left")}
				onDrop={(e) => handleDrop(e, "left")}
			/>

			{/* Center zone — middle column, middle row */}
			<div
				className={`pointer-events-auto m-1 rounded ${zoneClass("center")}`}
				onDragOver={(e) => handleDragOver(e, "center")}
				onDrop={(e) => handleDrop(e, "center")}
			/>

			{/* Right zone — third column, middle row */}
			<div
				className={`pointer-events-auto m-1 rounded ${zoneClass("right")}`}
				onDragOver={(e) => handleDragOver(e, "right")}
				onDrop={(e) => handleDrop(e, "right")}
			/>

			{/* Bottom zone — spans all 3 columns in last row */}
			<div
				className={`pointer-events-auto col-span-3 m-1 rounded ${zoneClass("bottom")}`}
				onDragOver={(e) => handleDragOver(e, "bottom")}
				onDrop={(e) => handleDrop(e, "bottom")}
			/>
		</div>
	);
}
