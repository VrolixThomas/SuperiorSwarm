import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserTab } from "../../src/renderer/browser/BrowserTab";
import { openBrowserTab, useWorkspaceBrowser } from "../../src/renderer/browser/lifecycle";
import { browserSlotBounds } from "../../src/renderer/browser/runtime-registry";
import { CommandPalette } from "../../src/renderer/components/CommandPalette";
import { OpenPanelButton } from "../../src/renderer/components/OpenPanelButton";
import { useActionStore } from "../../src/renderer/stores/action-store";
import { getAllPanes, usePaneStore } from "../../src/renderer/stores/pane-store";
import { useTabStore } from "../../src/renderer/stores/tab-store";

const fixture = {
	url: new URL(location.href).searchParams.get("url") ?? "",
	hide: (_value: boolean) => {},
	modal: (_value: boolean) => {},
	close: () => {},
	remount: () => {},
	panelHandle: (_visible: boolean) => {},
	bounds: () => {
		const host = document.querySelector<HTMLElement>("[data-browser-slot]");
		return host ? browserSlotBounds(host) : null;
	},
	selectOriginal: () => {
		const pane = usePaneStore.getState().findPaneForTab("workspace-a", "browser-test");
		if (pane) usePaneStore.getState().setActiveTabInPane("workspace-a", pane.id, "browser-test");
	},
	closeTab: (id: string) => {
		const pane = usePaneStore.getState().findPaneForTab("workspace-a", id);
		if (pane) usePaneStore.getState().removeTabFromPane("workspace-a", pane.id, id);
	},
	paletteOpen: () => useActionStore.getState().isPaletteOpen,
	closePalette: () => useActionStore.getState().closePalette(),
	open: (workspaceId: string) => openBrowserTab(workspaceId, fixture.url),
};
Object.assign(window, { browserFixture: fixture });
useTabStore.setState({ activeWorkspaceId: "workspace-a" });
openBrowserTab("workspace-a", fixture.url, "browser-test");

function Harness() {
	useWorkspaceBrowser();
	const layouts = usePaneStore((state) => state.layouts);
	const [hidden, hide] = useState(false);
	const [modal, setModal] = useState(false);
	const [panelHandle, setPanelHandle] = useState(true);
	fixture.panelHandle = setPanelHandle;
	fixture.hide = hide;
	fixture.modal = setModal;
	fixture.close = () => usePaneStore.getState().clearLayout("workspace-a");
	const pane = Object.values(layouts)
		.flatMap((layout) => getAllPanes(layout))
		.find((pane) => pane.tabs.some((tab) => tab.id === "browser-test"));
	const tab = pane?.tabs.find((tab) => tab.id === pane.activeTabId);
	return (
		<>
			<CommandPalette />
			{panelHandle && <OpenPanelButton onClick={() => setPanelHandle(false)} />}
			<div
				id="panel"
				style={{
					position: "absolute",
					inset: "40px 0 30px 30px",
					display: hidden ? "none" : "block",
				}}
			>
				{tab?.kind === "browser" && <BrowserTab tab={tab} />}
			</div>
			{modal && (
				<dialog
					open
					aria-label="Test dialog"
					className="fixed"
					style={{ position: "fixed", inset: 100, background: "#eee", zIndex: 100 }}
				>
					Dialog above browser
				</dialog>
			)}
		</>
	);
}
const root = document.getElementById("root");
function Root() {
	const [generation, setGeneration] = useState(0);
	fixture.remount = () => setGeneration((value) => value + 1);
	return (
		<StrictMode>
			<Harness key={generation} />
		</StrictMode>
	);
}
if (root) createRoot(root).render(<Root />);
