import { useEffect } from "react";
import { type BrowserOpenTab, browserOpenTabSchema } from "../../shared/browser";
import { useActionStore } from "../stores/action-store";
import { usePaneStore } from "../stores/pane-store";
import { useTabStore } from "../stores/tab-store";
import { browserRegistry } from "./runtime-registry";

export function openBrowserTab(
	workspaceId: string,
	url = "",
	browserId = `browser-${crypto.randomUUID()}`,
	options: Pick<BrowserOpenTab, "openerId" | "background" | "viewport"> = { viewport: "desktop" }
) {
	const existing = useTabStore
		.getState()
		.getTabsByWorkspace(workspaceId)
		.find((tab) => tab.id === browserId);
	if (!existing) {
		const tab = {
			kind: "browser" as const,
			id: browserId,
			workspaceId,
			title: "Browser",
			url,
			viewport: options.viewport,
		};
		const panes = usePaneStore.getState();
		const opener = options.openerId ? panes.findPaneForTab(workspaceId, options.openerId) : null;
		if (opener) {
			panes.addTabToPane(workspaceId, opener.id, tab);
			if (options.background && opener.activeTabId)
				panes.setActiveTabInPane(workspaceId, opener.id, opener.activeTabId);
			else if (useTabStore.getState().activeWorkspaceId === workspaceId)
				panes.setFocusedPane(opener.id);
		} else useTabStore.getState().addTab(tab);
	} else if (!options.background) useTabStore.getState().setActiveTab(browserId);
	return browserId;
}

/** Application-lifetime listeners. The registry, not a pane component, owns guests. */
export function useWorkspaceBrowser() {
	useEffect(() => {
		browserRegistry.start();
		const offOpen = window.electron.browser.onOpenTab((raw) => {
			const parsed = browserOpenTabSchema.safeParse(raw);
			if (parsed.success) {
				const tab = parsed.data;
				openBrowserTab(tab.workspaceId, tab.url, tab.browserId, tab);
			}
		});
		const offShortcut = window.electron.browser.onShortcut((event) => {
			if (event.kind === "palette") useActionStore.getState().openPalette();
			else if (event.kind === "close" || event.kind === "focus") {
				const tab = useTabStore
					.getState()
					.getAllTabs()
					.find((tab) => tab.id === event.browserId);
				if (tab) {
					const pane = usePaneStore.getState().findPaneForTab(tab.workspaceId, tab.id);
					if (pane) {
						if (event.kind === "close")
							usePaneStore.getState().removeTabFromPane(tab.workspaceId, pane.id, tab.id);
						else usePaneStore.getState().setFocusedPane(pane.id);
					}
				}
			} else {
				const input = document.querySelector<HTMLInputElement>(
					`[data-browser-address="${CSS.escape(event.browserId)}"]`
				);
				input?.focus();
				input?.select();
			}
		});
		return () => {
			offOpen();
			offShortcut();
			browserRegistry.stop();
		};
	}, []);
}
