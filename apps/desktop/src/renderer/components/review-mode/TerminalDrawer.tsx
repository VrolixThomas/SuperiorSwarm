import { type PointerEvent as ReactPointerEvent, useCallback } from "react";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { Terminal } from "../Terminal";

export function TerminalDrawer() {
	const drawerOpen = useReviewModeStore((state) => state.drawerOpen);
	const drawerHeight = useReviewModeStore((state) => state.drawerHeight);
	const setDrawerOpen = useReviewModeStore((state) => state.setDrawerOpen);
	const setDrawerHeight = useReviewModeStore((state) => state.setDrawerHeight);
	const setView = useReviewModeStore((state) => state.setView);
	const view = useReviewModeStore((state) => state.view);
	const terminal = useReviewModeStore((state) =>
		state.active ? (state.terminals[state.active.workspaceId] ?? null) : null
	);

	const startResize = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startY = event.clientY;
			const startHeight = drawerHeight;

			function onPointerMove(moveEvent: PointerEvent) {
				setDrawerHeight(startHeight + startY - moveEvent.clientY);
			}

			function onPointerUp() {
				window.removeEventListener("pointermove", onPointerMove);
				window.removeEventListener("pointerup", onPointerUp);
			}

			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", onPointerUp);
		},
		[drawerHeight, setDrawerHeight]
	);

	if (!drawerOpen || !terminal || view === "terminal") return null;

	return (
		<section
			className="relative shrink-0 border-t border-[var(--border)] bg-[var(--bg-base)]"
			style={{ height: drawerHeight }}
		>
			<div
				role="separator"
				aria-orientation="horizontal"
				aria-label="Resize AI review terminal"
				tabIndex={0}
				onPointerDown={startResize}
				onKeyDown={(event) => {
					if (event.key === "ArrowUp") {
						event.preventDefault();
						setDrawerHeight(drawerHeight + 24);
					}
					if (event.key === "ArrowDown") {
						event.preventDefault();
						setDrawerHeight(drawerHeight - 24);
					}
				}}
				className="absolute -top-1 left-0 z-10 h-2 w-full cursor-row-resize bg-transparent transition-colors duration-[120ms] hover:bg-[var(--accent)]"
			/>
			<div className="flex h-9 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3">
				<div className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
					AI review terminal
				</div>
				<button
					type="button"
					onClick={() => {
						setDrawerOpen(false);
						setView("terminal");
					}}
					className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					Open as tab
				</button>
				<button
					type="button"
					onClick={() => setDrawerOpen(false)}
					className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					Close
				</button>
			</div>
			<div className="h-[calc(100%-36px)]">
				<Terminal id={terminal.tabId} cwd={terminal.cwd} workspaceId={terminal.workspaceId} />
			</div>
		</section>
	);
}

export function TerminalTab() {
	const terminal = useReviewModeStore((state) =>
		state.active ? (state.terminals[state.active.workspaceId] ?? null) : null
	);

	if (!terminal) {
		return (
			<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-tertiary)]">
				No AI review terminal is attached
			</div>
		);
	}

	return (
		<div className="h-full min-h-0 bg-[var(--bg-base)]">
			<Terminal id={terminal.tabId} cwd={terminal.cwd} workspaceId={terminal.workspaceId} />
		</div>
	);
}
