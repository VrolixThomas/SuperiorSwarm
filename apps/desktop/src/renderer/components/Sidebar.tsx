import { useCallback, useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { useUpdateStore } from "../stores/update-store";
import { trpc } from "../trpc/client";
import { CrossRepoOrchestratorGroup } from "./CrossRepoOrchestratorGroup";
import { ProjectList } from "./ProjectList";
import { PullRequestsTab } from "./PullRequestsTab";
import { SidebarRail } from "./SidebarRail";
import { SidebarSplit } from "./SidebarSplit";
import { Tooltip } from "./Tooltip";
import { TicketsSidebar } from "./tickets/TicketsSidebar";

interface SidebarProps {
	collapsed: boolean;
	onExpand: (section?: "tickets" | "prs") => void;
}

export function Sidebar({ collapsed, onExpand }: SidebarProps) {
	const { openSettings } = useProjectStore();
	const segment = useTabStore((s) => s.sidebarSegment);
	const hasDismissedUpdate = useUpdateStore((s) => s.dismissedUpdateVersion !== null);
	const setSidebarSegment = useTabStore((s) => s.setSidebarSegment);

	const utils = trpc.useUtils();
	const openFolderMut = trpc.projects.openFolder.useMutation();
	const attachTerminalMut = trpc.workspaces.attachTerminal.useMutation();

	const openFolderAsyncRef = useRef(openFolderMut.mutateAsync);
	openFolderAsyncRef.current = openFolderMut.mutateAsync;
	const attachTerminalRef = useRef(attachTerminalMut.mutate);
	attachTerminalRef.current = attachTerminalMut.mutate;
	const newTerminalInFlightRef = useRef(false);

	const handleNewTerminal = useCallback(async () => {
		if (newTerminalInFlightRef.current) return;
		newTerminalInFlightRef.current = true;
		try {
			const res = await openFolderAsyncRef.current({ path: "~", quick: true });
			if (!res.project) return;
			utils.projects.list.invalidate();
			const tree = await utils.workspaces.listByProject.fetch({ projectId: res.project.id });
			const ws =
				tree.loose.find((w) => w.type === "branch" || (w.type === "folder" && !w.folderPath)) ??
				tree.loose[0] ??
				tree.orchestrators[0]?.workspace;
			if (!ws) return;
			const cwd = ws.worktreePath ?? ws.folderPath ?? res.project.repoPath;
			const store = useTabStore.getState();
			store.setActiveWorkspace(ws.id, cwd);
			const tabs = store.getTabsByWorkspace(ws.id);
			if (!tabs.some((t) => t.kind === "terminal")) {
				const tabId = store.addTerminalTab(ws.id, cwd, `${res.project.name}: ${ws.name}`);
				attachTerminalRef.current({ workspaceId: ws.id, terminalId: tabId });
			}
		} catch (err) {
			console.error("[quick-terminal]", err);
		} finally {
			newTerminalInFlightRef.current = false;
		}
	}, [utils]);

	useEffect(() => {
		const listener = () => {
			void handleNewTerminal();
		};
		window.addEventListener("quick-terminal", listener);
		return () => window.removeEventListener("quick-terminal", listener);
	}, [handleNewTerminal]);

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
					const labels = { repos: "Projects", tickets: "Tickets", prs: "PRs" } as const;
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
								{labels[seg]}
								{seg === "prs" && (hasAINotification || hasNewPRs) && segment !== "prs" && (
									<span className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-[#30d158]" />
								)}
							</button>
						</Tooltip>
					);
				})}
			</div>

			{/* Segment content */}
			<div className="flex min-h-0 flex-1 flex-col">
				{segment === "repos" && (
					<SidebarSplit
						top={
							<ProjectList
								onNewTerminal={() => void handleNewTerminal()}
								terminalPending={openFolderMut.isPending}
							/>
						}
						bottom={<CrossRepoOrchestratorGroup />}
					/>
				)}
				{segment === "tickets" && (
					<div className="min-h-0 flex-1 overflow-y-auto">
						<TicketsSidebar />
					</div>
				)}
				{segment === "prs" && (
					<div className="min-h-0 flex-1 overflow-y-auto">
						<PullRequestsTab />
					</div>
				)}
			</div>

			{/* Footer — Settings */}
			<div className="flex items-center border-t border-[var(--border-subtle)] p-2">
				<Tooltip
					label={hasDismissedUpdate ? "Settings — update ready" : "Settings"}
					actionId="general.settings"
				>
					<button
						type="button"
						onClick={openSettings}
						className="relative flex flex-1 items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
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
						{hasDismissedUpdate && (
							<span className="ml-auto size-[6px] shrink-0 rounded-full bg-[#30d158] shadow-[0_0_0_2px_var(--bg-base)]" />
						)}
					</button>
				</Tooltip>
			</div>
		</div>
	);
}
