import { useState } from "react";
import type { SidebarSegment } from "../../shared/types";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { DaemonInspector } from "./DaemonInspector";
import { ProjectList } from "./ProjectList";
import { PullRequestsTab } from "./PullRequestsTab";
import { SidebarRail } from "./SidebarRail";
import { Tooltip } from "./Tooltip";
import { TicketsSidebar } from "./tickets/TicketsSidebar";

interface SidebarProps {
	collapsed: boolean;
	onExpand: (section?: "tickets" | "prs") => void;
}

export function Sidebar({ collapsed, onExpand }: SidebarProps) {
	const { openAddModal, openSettings } = useProjectStore();
	const segment = useTabStore((s) => s.sidebarSegment);
	const setSidebarSegment = useTabStore((s) => s.setSidebarSegment);
	const [showDaemonInspector, setShowDaemonInspector] = useState(false);

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
			setSidebarSegment("tickets");
		} else if (section === "prs") {
			setSidebarSegment("prs");
		}
	};

	if (collapsed) {
		return <SidebarRail onExpand={handleExpand} />;
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)]">
			{/* Traffic light clearance */}
			<div className="app-drag h-[52px] shrink-0" />

			{/* Segmented control — always at top */}
			<div className="flex gap-1 px-2 py-1.5 border-b border-[var(--border-subtle)]">
				{(["repos", "tickets", "prs"] as const).map((seg) => {
					const actionIds = {
						repos: "nav.repos",
						tickets: "nav.tickets",
						prs: "nav.prs",
					} as const;
					const labels = { repos: "Repos", tickets: "Tickets", prs: "PRs" } as const;
					return (
						<Tooltip key={seg} label={labels[seg]} actionId={actionIds[seg]} className="flex-1">
							<button
								type="button"
								onClick={() => setSidebarSegment(seg)}
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
						</Tooltip>
					);
				})}
			</div>

			{/* Segment content */}
			<div className="flex-1 overflow-y-auto">
				{segment === "repos" && (
					<>
						<ProjectList />
						<div className="px-2 py-1.5">
							<button
								type="button"
								onClick={openAddModal}
								className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
							>
								<svg
									aria-hidden="true"
									width="13"
									height="13"
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
					</>
				)}
				{segment === "tickets" && <TicketsSidebar />}
				{segment === "prs" && <PullRequestsTab />}
			</div>

			{/* Footer — Settings + Daemon Inspector */}
			<div className="flex items-center gap-1 border-t border-[var(--border-subtle)] p-2">
				<Tooltip label="Settings" actionId="general.settings">
					<button
						type="button"
						onClick={openSettings}
						className="flex flex-1 items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
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
				</Tooltip>
				<button
					type="button"
					onClick={() => setShowDaemonInspector(true)}
					title="Daemon Inspector"
					className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<polyline points="4 17 10 11 4 5" />
						<line x1="12" y1="19" x2="20" y2="19" />
					</svg>
				</button>
			</div>
			{showDaemonInspector && <DaemonInspector onClose={() => setShowDaemonInspector(false)} />}
		</div>
	);
}
