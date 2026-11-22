import { useCallback, useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { FolderList } from "./FolderList";
import { OrchestratorList } from "./OrchestratorList";
import { PullRequestsTab } from "./PullRequestsTab";
import { RepositoryList } from "./RepositoryList";
import { type BandDescriptor, SidebarBandStack } from "./SidebarBandStack";
import { Tooltip } from "./Tooltip";
import { HermesSidebar } from "./hermes/HermesSidebar";
import { TicketsSidebar } from "./tickets/TicketsSidebar";

interface SidebarProps {
	collapsed: boolean;
	navigationInRail?: boolean;
	onExpand: (section?: "tickets" | "prs" | "hermes") => void;
}

export function Sidebar({ collapsed, navigationInRail = true }: SidebarProps) {
	const { openAddModal, openCreateCrossRepoModal } = useProjectStore();
	const { data: projectsList } = trpc.projects.list.useQuery();
	const segment = useTabStore((s) => s.sidebarSegment);
	const canGoBackWorkspace = useTabStore((s) => s.workspaceBackStack.length > 0);
	const canGoForwardWorkspace = useTabStore((s) => s.workspaceForwardStack.length > 0);
	const goBackWorkspace = useTabStore((s) => s.goBackWorkspace);
	const goForwardWorkspace = useTabStore((s) => s.goForwardWorkspace);

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

	const orchCount = trpc.crossRepoOrchestrators.list.useQuery().data?.length ?? 0;

	const all = projectsList ?? [];
	const folders = all.filter((p) => p.kind === "folder");
	const repos = all.filter((p) => p.kind !== "folder");
	const bands: BandDescriptor[] = [
		{
			id: "folders",
			title: "Folders",
			count: folders.length,
			onNew: openAddModal,
			newLabel: "Add Folder",
			present: folders.length > 0,
			body: <FolderList items={folders} />,
		},
		{
			id: "repositories",
			title: folders.length > 0 ? "Repositories" : "Projects",
			count: repos.length,
			onNew: openAddModal,
			newLabel: "Add Project",
			present: true,
			body: <RepositoryList items={repos} />,
		},
		{
			id: "orchestrators",
			title: "Orchestrators",
			count: orchCount,
			onNew: openCreateCrossRepoModal,
			newLabel: "New Orchestrator",
			present: true,
			body: <OrchestratorList />,
		},
	];

	if (collapsed) return null;

	return (
		<div
			data-workspace-sidebar
			className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-surface)]"
		>
			{/* Traffic light clearance */}
			{segment !== "prs" && (
				<div className="app-drag flex h-[52px] shrink-0 items-center pl-3 pr-2">
					<div className="app-no-drag flex shrink-0 items-center gap-0.5">
						<Tooltip label="Go Back" actionId="nav.workspaceBack">
							<button
								type="button"
								onClick={() => goBackWorkspace()}
								disabled={!canGoBackWorkspace}
								aria-label="Go Back"
								className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)] disabled:pointer-events-none disabled:opacity-35"
							>
								<svg
									aria-hidden="true"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M15 18l-6-6 6-6" />
								</svg>
							</button>
						</Tooltip>
						<Tooltip label="Go Forward" actionId="nav.workspaceForward">
							<button
								type="button"
								onClick={() => goForwardWorkspace()}
								disabled={!canGoForwardWorkspace}
								aria-label="Go Forward"
								className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)] disabled:pointer-events-none disabled:opacity-35"
							>
								<svg
									aria-hidden="true"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M9 18l6-6-6-6" />
								</svg>
							</button>
						</Tooltip>
					</div>
				</div>
			)}

			{/* Segment content */}
			<div className="flex min-h-0 flex-1 flex-col">
				{segment === "repos" && <SidebarBandStack bands={bands} />}
				{segment === "tickets" && (
					<div className="min-h-0 flex-1 overflow-y-auto">
						<TicketsSidebar />
					</div>
				)}
				{segment === "prs" && (
					<div className="min-h-0 flex-1 overflow-hidden">
						<PullRequestsTab navigationInRail={navigationInRail} />
					</div>
				)}
				{segment === "hermes" && <HermesSidebar />}
			</div>
		</div>
	);
}
