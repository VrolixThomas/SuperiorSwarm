import { useReviewModeStore } from "../../stores/review-mode-store";
import { Terminal } from "../Terminal";

export function TerminalDrawer() {
	const drawerOpen = useReviewModeStore((state) => state.drawerOpen);
	const setDrawerOpen = useReviewModeStore((state) => state.setDrawerOpen);
	const terminal = useReviewModeStore((state) =>
		state.active ? (state.terminals[state.active.workspaceId] ?? null) : null
	);

	if (!drawerOpen || !terminal) return null;

	return (
		<section className="h-[300px] shrink-0 border-t border-[var(--border)] bg-[var(--bg-base)]">
			<div className="flex h-9 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3">
				<div className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
					AI review terminal
				</div>
				<button
					type="button"
					onClick={() => setDrawerOpen(false)}
					className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					Close
				</button>
			</div>
			<div className="h-[calc(300px-36px)]">
				<Terminal id={terminal.tabId} cwd={terminal.cwd} workspaceId={terminal.workspaceId} />
			</div>
		</section>
	);
}
