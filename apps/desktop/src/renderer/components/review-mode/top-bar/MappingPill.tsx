export function MappingPill({
	placed,
	total,
	onOpen,
}: {
	placed: number;
	total: number;
	onOpen?: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			disabled={!onOpen}
			className="app-no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-[12px] text-[var(--text-secondary)] disabled:cursor-default"
			title={onOpen ? "Open agent workspace" : "Reading path is being mapped"}
		>
			<span
				aria-hidden="true"
				className="size-3 animate-spin rounded-full border-2 border-[var(--accent)] border-r-transparent"
			/>
			Mapping · {placed} of {total} placed
		</button>
	);
}
