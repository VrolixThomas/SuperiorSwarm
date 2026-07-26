import type { Pane } from "../../shared/pane-types";
import type { TerminalAPI } from "../../shared/types";
import { findPaneById, usePaneStore } from "../stores/pane-store";

export function terminalIdsInPane(pane: Pane): string[] {
	return pane.tabs.filter((tab) => tab.kind === "terminal").map((tab) => tab.id);
}

/**
 * User-facing pane closure must dispose terminal resources before removing the
 * only renderer metadata that can still identify them. Internal pane-store
 * closures used while moving tabs intentionally bypass this helper.
 */
export function closePaneWithTerminalCleanup(workspaceId: string, paneId: string): void {
	const paneStore = usePaneStore.getState();
	const layout = paneStore.getLayout(workspaceId);
	if (!layout) return;
	const pane = findPaneById(layout, paneId);
	if (!pane) return;

	const terminalApi = (
		globalThis as typeof globalThis & {
			electron?: { terminal: Pick<TerminalAPI, "dispose"> };
		}
	).electron?.terminal;
	for (const terminalId of terminalIdsInPane(pane)) {
		void terminalApi?.dispose(terminalId).catch(() => {});
	}
	paneStore.closePane(workspaceId, paneId);
}
