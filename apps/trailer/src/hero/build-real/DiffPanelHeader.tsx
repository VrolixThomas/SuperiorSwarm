// Mirrors PanelHeader inside apps/desktop/src/renderer/components/DiffPanel.tsx.
// Static — active tab is prop-driven, no click handlers.

type Tab = "changes" | "files" | "comments" | "ai-fixes";

const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
	{
		key: "changes",
		label: "Changes",
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				aria-hidden="true"
			>
				<path d="M4 6h8M4 10h5" />
				<circle cx="13" cy="10" r="1.5" fill="currentColor" stroke="none" />
			</svg>
		),
	},
	{
		key: "files",
		label: "Files",
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M2 3h5l2 2h5v8H2z" />
			</svg>
		),
	},
	{
		key: "comments",
		label: "Comments",
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3 3V4a1 1 0 0 1 1-1z" />
			</svg>
		),
	},
	{
		key: "ai-fixes",
		label: "Fixes",
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M6 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM11 8l.5 1.5L13 10l-1.5.5L11 12l-.5-1.5L9 10l1.5-.5z" />
			</svg>
		),
	},
];

export function DiffPanelHeader({ activeTab }: { activeTab: Tab }) {
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
			<div className="flex rounded-[var(--radius-sm)] bg-[var(--bg-base)] p-0.5">
				{tabs.map((t) => {
					const active = activeTab === t.key;
					return (
						<div
							key={t.key}
							className={[
								"flex items-center gap-1 rounded-[4px] px-2 py-1 transition-all duration-[120ms]",
								active
									? "bg-[var(--bg-elevated)] text-[var(--text-secondary)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-quaternary)]",
							].join(" ")}
						>
							{t.icon}
						</div>
					);
				})}
			</div>
			<div className="flex-1" />
			<button
				type="button"
				className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-quaternary)]"
				title="Close panel"
			>
				<svg
					width="10"
					height="10"
					viewBox="0 0 10 10"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<path d="M1 1l8 8M9 1l-8 8" />
				</svg>
			</button>
		</div>
	);
}
