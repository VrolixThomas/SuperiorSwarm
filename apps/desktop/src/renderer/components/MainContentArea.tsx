import { useEffect } from "react";
import { usePaneStore } from "../stores/pane-store";
import { useTabStore } from "../stores/tab-store";
import { LayoutRenderer } from "./panes/LayoutRenderer";

export function MainContentArea({ savedScrollback }: { savedScrollback: Record<string, string> }) {
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const layout = usePaneStore((s) => (activeWorkspaceId ? s.layouts[activeWorkspaceId] : null));

	// Ensure a default layout exists — in an effect to avoid state mutation during render
	useEffect(() => {
		if (activeWorkspaceId && !layout) {
			usePaneStore.getState().ensureLayout(activeWorkspaceId);
		}
	}, [activeWorkspaceId, layout]);

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
