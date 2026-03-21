import { useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { ProjectList } from "./ProjectList";
import { PullRequestsTab } from "./PullRequestsTab";
import { SettingsView } from "./SettingsView";
import { SidebarRail } from "./SidebarRail";
import { TicketsTab } from "./TicketsTab";

type SidebarSegment = "repos" | "tickets" | "prs";

interface SidebarProps {
	collapsed: boolean;
	onExpand: (section?: "tickets" | "prs") => void;
}

export function Sidebar({ collapsed, onExpand }: SidebarProps) {
	const { openAddModal, sidebarView, openSettings } = useProjectStore();
	const [segment, setSegment] = useState<SidebarSegment>("repos");

	// Check if any AI reviews need attention (ready or failed)
	const reviewDraftsQuery = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
		staleTime: 5_000,
	});
	const hasAINotification = (reviewDraftsQuery.data ?? []).some(
		(d) => d.status === "ready" || d.status === "failed"
	);

	// Check if there are new PRs from the backend poller
	const cachedPRs = trpc.prPoller.getCachedPRs.useQuery(undefined, {
		staleTime: 10_000,
		refetchInterval: 30_000,
	});
	const hasNewPRs = (cachedPRs.data?.length ?? 0) > 0;

	const handleExpand = (section?: "tickets" | "prs") => {
		onExpand(section);
		if (section === "tickets") {
			setSegment("tickets");
		} else if (section === "prs") {
			setSegment("prs");
		}
	};

	if (collapsed) {
		return <SidebarRail onExpand={handleExpand} />;
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)]">
			{/* Traffic light clearance */}
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
					{/* Segmented control — always at top */}
					<div className="flex gap-1 px-2 py-1.5 border-b border-[var(--border-subtle)]">
						{(["repos", "tickets", "prs"] as const).map((seg) => (
							<button
								key={seg}
								type="button"
								onClick={() => setSegment(seg)}
								className={`relative flex-1 rounded-[5px] py-1 text-[10px] font-medium capitalize transition-colors ${
									segment === seg
										? "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
										: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
								}`}
							>
								{seg === "prs" ? "PRs" : seg.charAt(0).toUpperCase() + seg.slice(1)}
								{seg === "prs" && (hasAINotification || hasNewPRs) && segment !== "prs" && (
									<span className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-[#30d158]" />
								)}
							</button>
						))}
					</div>

					{/* Segment content */}
					<div className="flex-1 overflow-y-auto">
						{segment === "repos" && (
							<>
								{/* Add Repository */}
								<div className="px-2 py-2">
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
								<ProjectList />
							</>
						)}
						{segment === "tickets" && <TicketsTab />}
						{segment === "prs" && <PullRequestsTab />}
					</div>

					{/* Footer — Settings */}
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
