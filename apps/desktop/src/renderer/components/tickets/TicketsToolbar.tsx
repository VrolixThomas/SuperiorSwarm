import type { TicketViewMode } from "../../../shared/tickets";

interface TicketsToolbarProps {
	projectName: string;
	providerLabel: string;
	ticketCount: number;
	viewMode: TicketViewMode;
	onViewModeChange: (mode: TicketViewMode) => void;
	lastFetched: string | null;
}

const VIEW_MODES: { mode: TicketViewMode; label: string }[] = [
	{ mode: "board", label: "Board" },
	{ mode: "list", label: "List" },
	{ mode: "table", label: "Table" },
];

function formatStaleness(lastFetched: string | null): string | null {
	if (!lastFetched) return null;
	const diffMs = Date.now() - new Date(lastFetched).getTime();
	if (diffMs < 60_000) return null; // Fresh enough, don't show
	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 60) return `Updated ${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	return `Updated ${hours}h ago`;
}

export function TicketsToolbar({
	projectName,
	providerLabel,
	ticketCount,
	viewMode,
	onViewModeChange,
	lastFetched,
}: TicketsToolbarProps) {
	const staleness = formatStaleness(lastFetched);

	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
			<span className="text-[13px] font-semibold text-[var(--text)]">{projectName}</span>
			<span className="text-[10px] text-[var(--text-quaternary)]">
				{providerLabel} · {ticketCount} tickets
			</span>
			{staleness && (
				<span className="text-[10px] text-[var(--text-quaternary)] opacity-60">
					· {staleness}
				</span>
			)}
			<div className="flex-1" />
			<div className="flex gap-0.5 rounded-[6px] bg-[var(--bg-elevated)] p-[2px]">
				{VIEW_MODES.map(({ mode, label }) => (
					<button
						key={mode}
						type="button"
						onClick={() => onViewModeChange(mode)}
						className={`rounded-[4px] px-2.5 py-1 text-[10px] transition-colors ${
							viewMode === mode
								? "bg-[var(--bg-overlay)] font-medium text-[var(--text)]"
								: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
						}`}
					>
						{label}
					</button>
				))}
			</div>
		</div>
	);
}
