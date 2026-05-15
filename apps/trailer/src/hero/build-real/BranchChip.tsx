// Mirrors apps/desktop/src/renderer/components/BranchChip.tsx. Static (no
// tRPC, no store) — accepts already-resolved branch status as props.

interface Props {
	branch: string;
	ahead?: number;
	behind?: number;
}

export function BranchChip({ branch, ahead = 0, behind = 0 }: Props) {
	return (
		<button
			type="button"
			className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1 text-[12px]"
		>
			<svg
				aria-hidden="true"
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="var(--text-secondary)"
				strokeWidth="2"
			>
				<path d="M6 3v12" />
				<circle cx="18" cy="6" r="3" />
				<circle cx="6" cy="18" r="3" />
				<path d="M18 9a9 9 0 0 1-9 9" />
			</svg>

			<span className="max-w-[180px] truncate font-medium text-[var(--text)]">{branch}</span>

			{ahead > 0 && (
				<span className="rounded-full bg-[rgba(48,209,88,0.1)] px-1.5 text-[10px] text-[var(--color-success)]">
					↑{ahead}
				</span>
			)}
			{behind > 0 && (
				<span className="rounded-full bg-[rgba(255,159,10,0.1)] px-1.5 text-[10px] text-[var(--color-warning)]">
					↓{behind}
				</span>
			)}

			<svg
				aria-hidden="true"
				width="8"
				height="8"
				viewBox="0 0 24 24"
				fill="none"
				stroke="var(--text-quaternary)"
				strokeWidth="2.5"
			>
				<path d="m6 9 6 6 6-6" />
			</svg>
		</button>
	);
}
