import { afterEach, expect, test } from "bun:test";
import { openBrowserTab } from "../src/renderer/browser/lifecycle";
import { collectSessionSnapshot, deserializeLayout } from "../src/renderer/session-snapshot";
import { getAllPanes, usePaneStore } from "../src/renderer/stores/pane-store";
import { useTabStore } from "../src/renderer/stores/tab-store";

afterEach(() => {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
});
for (const background of [true, false]) {
	test(`new linked tab uses its opener pane and respects background=${background}`, () => {
		useTabStore.setState({ activeWorkspaceId: "workspace" });
		usePaneStore.setState({
			focusedPaneId: "other",
			layouts: {
				workspace: {
					type: "split",
					id: "split",
					direction: "horizontal",
					ratio: 0.5,
					children: [
						{
							type: "pane",
							id: "source",
							activeTabId: "original",
							tabs: [
								{
									kind: "browser",
									id: "original",
									workspaceId: "workspace",
									title: "Source",
									url: "https://example.com",
									viewport: "desktop",
								},
							],
						},
						{ type: "pane", id: "other", activeTabId: null, tabs: [] },
					],
				},
			},
		});
		openBrowserTab("workspace", "https://example.com/next", "linked", {
			openerId: "original",
			background,
			viewport: "phone",
		});
		const source = usePaneStore.getState().findPaneForTab("workspace", "linked");
		expect(source?.id).toBe("source");
		expect(source?.activeTabId).toBe(background ? "original" : "linked");
		expect(usePaneStore.getState().focusedPaneId).toBe(background ? "other" : "source");
		expect(source?.tabs.find((tab) => tab.id === "linked")).toMatchObject({ viewport: "phone" });
	});
}
test("browser metadata survives split movement and persistence without becoming a terminal", () => {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	useTabStore.getState().addTab({
		kind: "browser",
		id: "browser-persist",
		workspaceId: "workspace",
		title: "My local app",
		url: "http://localhost:5173/path",
		viewport: "phone",
	});
	const first = usePaneStore.getState().getFocusedPane("workspace");
	if (!first) throw Error("Missing pane");
	usePaneStore.getState().splitPane("workspace", first.id, "horizontal", first.tabs[0]);
	const snapshot = collectSessionSnapshot();
	expect(snapshot.sessions).toEqual([]);
	const saved = snapshot.paneLayouts["workspace"];
	if (!saved) throw Error("Missing serialized layout");
	const restored = deserializeLayout(JSON.parse(saved), new Map());
	if (!restored) throw Error("Browser-only layout was discarded");
	expect(getAllPanes(restored).flatMap((pane) => pane.tabs)).toEqual([
		{
			kind: "browser",
			id: "browser-persist",
			workspaceId: "workspace",
			title: "My local app",
			url: "http://localhost:5173/path",
			viewport: "phone",
		},
	]);
});
