import { useEffect, useState } from "react";

interface AgentStatusChipProps {
	active: boolean;
	startedAt?: string | Date;
	canceling?: boolean;
	onOpen?: () => void;
	onCancel: (() => void) | null;
}

function elapsedLabel(startedAt?: string | Date): string {
	if (!startedAt) return "Reviewing...";
	const timestamp = new Date(startedAt).getTime();
	if (Number.isNaN(timestamp)) return "Reviewing...";
	const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
	if (minutes < 1) return "Reviewing...";
	if (minutes < 60) return `Reviewing ${minutes}m`;
	return `Reviewing ${Math.floor(minutes / 60)}h`;
}

export function AgentStatusChip({
	active,
	startedAt,
	canceling = false,
	onOpen,
	onCancel,
}: AgentStatusChipProps) {
	const [, forceTick] = useState(0);

	useEffect(() => {
		if (!active) return;
		const timer = window.setInterval(() => forceTick((tick) => tick + 1), 30_000);
		return () => window.clearInterval(timer);
	}, [active]);

	if (!active) return null;

	return (
		<div className="flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-[12px] text-[var(--text-secondary)]">
			<span className="size-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
			<button
				type="button"
				onClick={onOpen}
				className="rounded-[var(--radius-sm)] text-left transition-colors duration-[120ms] hover:text-[var(--text)]"
			>
				{elapsedLabel(startedAt)}
			</button>
			{onCancel && (
				<button
					type="button"
					disabled={canceling}
					onClick={onCancel}
					className="ml-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					Cancel
				</button>
			)}
		</div>
	);
}
