import { useEffect, useState } from "react";
import { usePaneStore } from "../stores/pane-store";
import { shouldShowReviewMode, useReviewModeStore } from "../stores/review-mode-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { BranchChip } from "./BranchChip";
import { QuickActionBar } from "./QuickActionBar";
import { type ContextMenuAction, QuickActionContextMenu } from "./QuickActionContextMenu";
import { QuickActionPopover } from "./QuickActionPopover";
import { HermesSessionView } from "./hermes/HermesSessionView";
import { LayoutRenderer } from "./panes/LayoutRenderer";
import { QueueBar } from "./queue/QueueBar";
import { QueueView } from "./queue/QueueView";
import { QueueWorkspaceHeader } from "./queue/QueueWorkspaceHeader";
import { ReviewModeShell } from "./review-mode/ReviewModeShell";
import { TicketsCanvas } from "./tickets/TicketsCanvas";

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
	const activeReview = useReviewModeStore((s) => s.active);

	const [showQuickActionPopover, setShowQuickActionPopover] = useState(false);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const [editAction, setEditAction] = useState<ContextMenuState["action"] | undefined>(undefined);

	// Derive projectId from active workspace for the BranchChip
	const wsQuery = trpc.workspaces.getById.useQuery(
		{ id: activeWorkspaceId ?? "" },
		{ enabled: !!activeWorkspaceId, staleTime: 30_000 }
	);
	const projectId = wsQuery.data?.projectId ?? null;
	const coordinatorQuery = trpc.crossRepoOrchestrators.get.useQuery(
		{ id: activeWorkspaceId ?? "" },
		{ enabled: !!activeWorkspaceId && wsQuery.isSuccess && !wsQuery.data, staleTime: 30_000 }
	);
	const queueEntity = wsQuery.data
		? { kind: "workspace" as const, id: wsQuery.data.id }
		: coordinatorQuery.data
			? { kind: "coordinator" as const, id: coordinatorQuery.data.id }
			: null;

	const projectQuery = trpc.projects.getById.useQuery(
		{ id: projectId ?? "" },
		{ enabled: !!projectId, staleTime: 30_000 }
	);
	const isFolderProject = projectQuery.data?.kind === "folder";

	useEffect(() => {
		function handleQuickActionContext(e: Event) {
			const detail = (e as CustomEvent<ContextMenuState>).detail;
			setContextMenu(detail);
		}
		window.addEventListener("quick-action-context", handleQuickActionContext);
		return () => window.removeEventListener("quick-action-context", handleQuickActionContext);
	}, []);

	function handlePopoverClose() {
		setShowQuickActionPopover(false);
		setEditAction(undefined);
	}

	if (sidebarSegment === "queue") return <QueueView />;

	if (sidebarSegment === "tickets") {
		return <TicketsCanvas />;
	}

	if (sidebarSegment === "hermes") {
		return <HermesSessionView />;
	}

	if (sidebarSegment === "prs") {
		if (shouldShowReviewMode(sidebarSegment, activeWorkspaceId, activeReview)) {
			return (
				<div className="flex h-full min-h-0 flex-col">
					<QueueBar entity={queueEntity} />
					{queueEntity && (
						<div className="shrink-0">
							<QueueWorkspaceHeader
								key={`${queueEntity.kind}:${queueEntity.id}`}
								entity={queueEntity}
								title={wsQuery.data?.name ?? coordinatorQuery.data?.name ?? "Workspace"}
								projectName={projectQuery.data?.name}
							/>
						</div>
					)}
					<div className="min-h-0 flex-1">
						<ReviewModeShell />
					</div>
				</div>
			);
		}

		return (
			<main className="flex h-full min-w-0 items-center justify-center overflow-hidden">
				<div className="max-w-[320px] px-6 text-center">
					<div className="text-[13px] font-medium text-[var(--text-secondary)]">
						Select a pull request
					</div>
					<div className="mt-1 text-[12px] leading-5 text-[var(--text-quaternary)]">
						Open PRs stay available in the sidebar while you review.
					</div>
				</div>
			</main>
		);
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
			<QueueBar entity={queueEntity} />
			{queueEntity && (
				<div className="shrink-0">
					<QueueWorkspaceHeader
						key={`${queueEntity.kind}:${queueEntity.id}`}
						entity={queueEntity}
						title={wsQuery.data?.name ?? coordinatorQuery.data?.name ?? "Workspace"}
						projectName={projectQuery.data?.name}
					/>
				</div>
			)}
			{/* Branch indicator bar */}
			{projectId && !isFolderProject && (
				<div className="app-drag flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1">
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

			{showQuickActionPopover && projectId && !isFolderProject && (
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
