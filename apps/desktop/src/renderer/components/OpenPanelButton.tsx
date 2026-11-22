export function OpenPanelButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="fixed top-1/2 right-0 z-10 -translate-y-1/2 rounded-l-md border border-r-0 border-[var(--border)] bg-[var(--bg-surface)] px-1 py-5 text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
			title="Open panel"
		>
			<svg
				width="8"
				height="14"
				viewBox="0 0 8 14"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M7 1L1 7l6 6" />
			</svg>
		</button>
	);
}
