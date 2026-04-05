import { useEffect, useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { BranchChip } from "./BranchChip";
import { QuickActionBar, resolveQuickActionCwd } from "./QuickActionBar";
import { QuickActionContextMenu, type ContextMenuAction } from "./QuickActionContextMenu";
import { QuickActionPopover } from "./QuickActionPopover";
import { LayoutRenderer } from "./panes/LayoutRenderer";
import { TicketsCanvas } from "./tickets/TicketsCanvas";
import { usePaneStore } from "../stores/pane-store";

interface ContextMenuState {
	action: ContextMenuAction;
	x: number;
	y: number;
}

export function MainContentArea({ savedScrollback }: { savedScrollback: Record<string, string> }) {
	const sidebarSegment = useTabStore((s) => s.sidebarSegment);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const cwd = useTabStore((s) => s.activeWorkspaceCwd);
	const layout = usePaneStore((s) => (activeWorkspaceId ? s.layouts[activeWorkspaceId] : null));

	const [showQuickActionPopover, setShowQuickActionPopover] = useState(false);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const [editAction, setEditAction] = useState<ContextMenuState["action"] | undefined>(undefined);

	// Derive projectId from active workspace for the BranchChip
	const wsQuery = trpc.workspaces.getById.useQuery(
		{ id: activeWorkspaceId ?? "" },
		{ enabled: !!activeWorkspaceId, staleTime: 30_000 }
	);
	const projectId = wsQuery.data?.projectId ?? null;

	useEffect(() => {
		function handleQuickActionContext(e: Event) {
			const detail = (e as CustomEvent<ContextMenuState>).detail;
			setContextMenu(detail);
		}
		window.addEventListener("quick-action-context", handleQuickActionContext);
		return () => window.removeEventListener("quick-action-context", handleQuickActionContext);
	}, []);

	useEffect(() => {
		const cleanup = window.electron.quickActions.onTrigger(({ command, label, cwd }) => {
			const state = useTabStore.getState();
			const workspaceId = state.activeWorkspaceId;
			const repoPath = state.activeWorkspaceCwd;
			if (!workspaceId) return;
			const resolvedCwd = resolveQuickActionCwd(cwd, repoPath);
			const tabId = state.addTerminalTab(workspaceId, resolvedCwd, label);
			setTimeout(() => {
				window.electron.terminal.write(tabId, `${command}\n`);
			}, 300);
		});
		return cleanup;
	}, []);

	function handlePopoverClose() {
		setShowQuickActionPopover(false);
		setEditAction(undefined);
	}

	if (sidebarSegment === "tickets") {
		return <TicketsCanvas />;
	}

	if (!activeWorkspaceId || !layout) {
		return (
			<main className="flex h-full min-w-0 items-center justify-center overflow-hidden">
				<div className="text-[13px] text-[var(--text-quaternary)]">
					Select a workspace to open a terminal
				</div>
			</main>
		);
	}

	return (
		<main className="flex h-full min-w-0 flex-col overflow-hidden">
			{/* Branch indicator bar */}
			{projectId && (
				<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1">
					<BranchChip projectId={projectId} />
					<QuickActionBar
						projectId={projectId}
						repoPath={cwd}
						workspaceId={activeWorkspaceId}
						onAddClick={() => {
							setEditAction(undefined);
							setShowQuickActionPopover(true);
						}}
					/>
				</div>
			)}
			<LayoutRenderer
				node={layout}
				workspaceId={activeWorkspaceId}
				savedScrollback={savedScrollback}
			/>

			{contextMenu && (
				<QuickActionContextMenu
					action={contextMenu.action}
					x={contextMenu.x}
					y={contextMenu.y}
					onClose={() => setContextMenu(null)}
					onEdit={(action) => {
						setEditAction(action);
						setShowQuickActionPopover(true);
					}}
				/>
			)}

			{showQuickActionPopover && projectId && (
				<QuickActionPopover
					projectId={projectId}
					repoPath={cwd}
					onClose={handlePopoverClose}
					editAction={editAction}
				/>
			)}
		</main>
	);
}
