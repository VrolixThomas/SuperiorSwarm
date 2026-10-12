import type { Pane } from "../../shared/pane-types";
import type { TerminalAPI } from "../../shared/types";
import { findPaneById, usePaneStore } from "../stores/pane-store";

export function terminalIdsInPane(pane: Pane): string[] {
	return pane.tabs.filter((tab) => tab.kind === "terminal").map((tab) => tab.id);
}

function disposeTerminal(id: string): void {
	const terminalApi = (
		globalThis as typeof globalThis & {
			electron?: { terminal: Pick<TerminalAPI, "dispose"> };
		}
	).electron?.terminal;
	void terminalApi?.dispose(id).catch(() => {});
}

/** Close a tab intentionally; moving/hiding tabs only changes layout state. */
export function closeTabWithTerminalCleanup(
	workspaceId: string,
	paneId: string,
	tabId: string
): void {
	const paneStore = usePaneStore.getState();
	const layout = paneStore.getLayout(workspaceId);
	if (!layout) return;
	const tab = findPaneById(layout, paneId)?.tabs.find((tab) => tab.id === tabId);
	if (!tab) return;
	if (tab.kind === "terminal") disposeTerminal(tab.id);
	paneStore.removeTabFromPane(workspaceId, paneId, tabId);
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

	for (const terminalId of terminalIdsInPane(pane)) {
		disposeTerminal(terminalId);
	}
	paneStore.closePane(workspaceId, paneId);
}
