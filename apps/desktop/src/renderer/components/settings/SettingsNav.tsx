import { useProjectStore, type SettingsCategory } from "../../stores/projects";

const NAV_ITEMS: { id: SettingsCategory; label: string; icon: React.ReactNode }[] = [
	{
		id: "general",
		label: "General",
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<circle cx="12" cy="12" r="3" />
				<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
			</svg>
		),
	},
	{
		id: "integrations",
		label: "Integrations",
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
				<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
			</svg>
		),
	},
	{
		id: "ai-review",
		label: "AI Review",
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
			</svg>
		),
	},
];

export function SettingsNav() {
	const { closeSettings, settingsCategory, setSettingsCategory } = useProjectStore();

	return (
		<div className="flex h-full w-[220px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
			{/* Traffic light clearance */}
			<div
				className="shrink-0"
				style={{ height: 52, WebkitAppRegion: "drag" } as React.CSSProperties}
			/>

			{/* Back button */}
			<div className="px-3 pb-4">
				<button
					type="button"
					onClick={closeSettings}
					className="flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[13px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path
							d="M10 3L5 8l5 5"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					Back
				</button>
			</div>

			{/* Main nav */}
			<div className="flex-1 px-3">
				<div className="pb-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
					Settings
				</div>
				<div className="flex flex-col gap-0.5">
					{NAV_ITEMS.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => setSettingsCategory(item.id)}
							className={`flex items-center gap-2 rounded-[6px] px-3 py-[7px] text-[13px] transition-colors ${
								settingsCategory === item.id
									? "bg-[rgba(10,132,255,0.12)] text-[var(--accent)]"
									: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
							}`}
						>
							{item.icon}
							{item.label}
						</button>
					))}
				</div>

				{/* About section */}
				<div className="mt-6 border-t border-[var(--border-subtle)] pt-4">
					<div className="pb-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
						About
					</div>
					<button
						type="button"
						onClick={() => setSettingsCategory("about")}
						className={`flex w-full items-center gap-2 rounded-[6px] px-3 py-[7px] text-[13px] transition-colors ${
							settingsCategory === "about"
								? "bg-[rgba(10,132,255,0.12)] text-[var(--accent)]"
								: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
						}`}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="16" x2="12" y2="12" />
							<line x1="12" y1="8" x2="12.01" y2="8" />
						</svg>
						About
					</button>
				</div>
			</div>
		</div>
	);
}
