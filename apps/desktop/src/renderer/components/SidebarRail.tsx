import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

interface SidebarRailProps {
	onExpand: (section?: "tickets" | "prs") => void;
}

export function SidebarRail({ onExpand }: SidebarRailProps) {
	const { openAddModal, openSettings } = useProjectStore();
	const { data: projectsList } = trpc.projects.list.useQuery();

	return (
		<div className="flex h-full w-full flex-col items-center bg-[var(--bg-surface)]">
			{/* Traffic light clearance */}
			<div
				className="w-full shrink-0"
				style={{ height: 52, WebkitAppRegion: "drag" } as React.CSSProperties}
			/>

			{/* Monogram */}
			<div className="pb-4">
				<span className="text-[11px] font-semibold text-[var(--text-quaternary)]">BF</span>
			</div>

			{/* Add Repository */}
			<button
				type="button"
				onClick={openAddModal}
				title="Add Repository"
				className="mb-3 flex size-8 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
			>
				<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
					<path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				</svg>
			</button>

			{/* Project initials */}
			<div className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto py-1">
				{projectsList?.map((project) => (
					<button
						key={project.id}
						type="button"
						title={project.name}
						onClick={() => onExpand()}
						className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-medium text-[var(--text-secondary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]"
						style={{
							borderLeft: `2px solid ${project.color ?? "transparent"}`,
						}}
					>
						{project.name.slice(0, 2).toUpperCase()}
					</button>
				))}
			</div>

			{/* Section icons with badges */}
			<div className="flex flex-col items-center gap-1 border-t border-[var(--border-subtle)] py-2">
				{/* Tickets icon */}
				<button
					type="button"
					title="Tickets"
					onClick={() => onExpand("tickets")}
					className="flex size-8 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg
						aria-hidden="true"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
						<rect x="9" y="3" width="6" height="4" rx="1" />
					</svg>
				</button>

				{/* PRs icon */}
				<button
					type="button"
					title="Pull Requests"
					onClick={() => onExpand("prs")}
					className="flex size-8 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg
						aria-hidden="true"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<circle cx="18" cy="18" r="3" />
						<circle cx="6" cy="6" r="3" />
						<path d="M6 9v12M18 9v0" />
						<path d="M13 6h3a2 2 0 0 1 2 2v1" />
					</svg>
				</button>
			</div>

			{/* Settings */}
			<div className="border-t border-[var(--border-subtle)] p-2">
				<button
					type="button"
					title="Settings"
					onClick={openSettings}
					className="flex size-8 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg
						aria-hidden="true"
						width="15"
						height="15"
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
				</button>
			</div>
		</div>
	);
}
