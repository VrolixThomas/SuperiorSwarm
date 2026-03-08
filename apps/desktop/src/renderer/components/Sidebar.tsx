import { useRef, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { ProjectList } from "./ProjectList";
import { PullRequestsTab } from "./PullRequestsTab";
import { SectionHeader } from "./SectionHeader";
import { SettingsView } from "./SettingsView";
import { SidebarRail } from "./SidebarRail";
import { TicketsTab } from "./TicketsTab";

interface SidebarProps {
	collapsed: boolean;
	onExpand: (section?: "tickets" | "prs") => void;
}

export function Sidebar({ collapsed, onExpand }: SidebarProps) {
	const { openAddModal, sidebarView, openSettings } = useProjectStore();
	const [ticketsOpen, setTicketsOpen] = useState(true);
	const [prsOpen, setPrsOpen] = useState(true);
	const ticketsRef = useRef<HTMLDivElement>(null);
	const prsRef = useRef<HTMLDivElement>(null);

	const handleExpand = (section?: "tickets" | "prs") => {
		onExpand(section);
		// After expand, scroll to section
		if (section === "tickets") {
			requestAnimationFrame(() => {
				setTicketsOpen(true);
				ticketsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
			});
		} else if (section === "prs") {
			requestAnimationFrame(() => {
				setPrsOpen(true);
				prsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
			});
		}
	};

	if (collapsed) {
		return <SidebarRail onExpand={handleExpand} />;
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)]">
			{/* Traffic light clearance — empty drag region */}
			<div
				className="shrink-0"
				style={
					{
						height: 52,
						WebkitAppRegion: "drag",
					} as React.CSSProperties
				}
			/>

			{sidebarView === "settings" ? (
				<SettingsView />
			) : (
				<>
					{/* Add Repository */}
					<div className="px-2 pb-2">
						<button
							type="button"
							onClick={openAddModal}
							className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
						>
							<svg
								aria-hidden="true"
								width="14"
								height="14"
								viewBox="0 0 16 16"
								fill="none"
								className="shrink-0"
							>
								<path
									d="M8 3v10M3 8h10"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
								/>
							</svg>
							<span className="truncate">Add Repository</span>
						</button>
					</div>

					{/* Project list + Unified tickets/PRs */}
					<div className="flex-1 overflow-y-auto py-1">
						<ProjectList />

						{/* Tickets Section */}
						<div ref={ticketsRef} className="mt-2 border-t border-[var(--border-subtle)] pt-2">
							<SectionHeader
								label="Tickets"
								isOpen={ticketsOpen}
								onToggle={() => setTicketsOpen(!ticketsOpen)}
							/>
							{ticketsOpen && <TicketsTab />}
						</div>

						{/* Pull Requests Section */}
						<div ref={prsRef} className="mt-2 border-t border-[var(--border-subtle)] pt-2">
							<SectionHeader
								label="Pull Requests"
								isOpen={prsOpen}
								onToggle={() => setPrsOpen(!prsOpen)}
							/>
							{prsOpen && <PullRequestsTab />}
						</div>
					</div>

					{/* Footer — Settings button */}
					<div className="border-t border-[var(--border-subtle)] p-2">
						<button
							type="button"
							onClick={openSettings}
							className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
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
								className="shrink-0"
							>
								<circle cx="12" cy="12" r="3" />
								<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
							</svg>
							<span className="truncate">Settings</span>
						</button>
					</div>
				</>
			)}
		</div>
	);
}
