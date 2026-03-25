import { usePaneStore } from "../stores/pane-store";
import { useTabStore } from "../stores/tab-store";
import { LayoutRenderer } from "./panes/LayoutRenderer";
import { TicketsCanvas } from "./tickets/TicketsCanvas";

export function MainContentArea({ savedScrollback }: { savedScrollback: Record<string, string> }) {
	const sidebarSegment = useTabStore((s) => s.sidebarSegment);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const layout = usePaneStore((s) => (activeWorkspaceId ? s.layouts[activeWorkspaceId] : null));

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
			<LayoutRenderer
				node={layout}
				workspaceId={activeWorkspaceId}
				savedScrollback={savedScrollback}
			/>
		</main>
	);
}
