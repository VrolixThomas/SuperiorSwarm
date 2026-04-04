import { usePaneStore } from "../stores/pane-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { BranchChip } from "./BranchChip";
import { LayoutRenderer } from "./panes/LayoutRenderer";
import { TicketsCanvas } from "./tickets/TicketsCanvas";

export function MainContentArea({ savedScrollback }: { savedScrollback: Record<string, string> }) {
	const sidebarSegment = useTabStore((s) => s.sidebarSegment);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const layout = usePaneStore((s) => (activeWorkspaceId ? s.layouts[activeWorkspaceId] : null));

	// Derive projectId from active workspace for the BranchChip
	const wsQuery = trpc.workspaces.getById.useQuery(
		{ id: activeWorkspaceId ?? "" },
		{ enabled: !!activeWorkspaceId }
	);
	const projectId = wsQuery.data?.projectId ?? null;

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
				</div>
			)}
			<LayoutRenderer
				node={layout}
				workspaceId={activeWorkspaceId}
				savedScrollback={savedScrollback}
			/>
		</main>
	);
}
