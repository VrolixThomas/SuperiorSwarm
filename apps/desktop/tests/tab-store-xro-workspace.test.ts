import { beforeEach, describe, expect, test } from "bun:test";
import { getAllPanes, usePaneStore } from "../src/renderer/stores/pane-store";
import { useTabStore } from "../src/renderer/stores/tab-store";

function resetStores() {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	useTabStore.setState({ activeWorkspaceId: null, activeWorkspaceCwd: "" });
}

describe("openXroWorkspace", () => {
	beforeEach(() => resetStores());

	test("sets active workspace and builds terminal-left / canvas-right split", () => {
		const result = useTabStore.getState().openXroWorkspace("xro-1", "Checkout", "/tmp/xro-1");

		expect(useTabStore.getState().activeWorkspaceId).toBe("xro-1");
		expect(result.started).toBe(true);

		const tabs = useTabStore.getState().getTabsByWorkspace("xro-1");
		const terminals = tabs.filter((t) => t.kind === "terminal");
		const canvases = tabs.filter((t) => t.kind === "xro-canvas");
		expect(terminals).toHaveLength(1);
		expect(canvases).toHaveLength(1);
		const [term] = terminals;
		expect(result.terminalTabId).toBe(term?.id);

		const layout = usePaneStore.getState().layouts["xro-1"];
		expect(layout?.type).toBe("split");
		if (layout?.type === "split") {
			const [left, right] = layout.children;
			expect(left.type === "pane" && left.tabs[0]?.kind).toBe("terminal");
			expect(right.type === "pane" && right.tabs[0]?.kind).toBe("xro-canvas");
		}
	});

	test("reattaches without spawning a second coordinator", () => {
		useTabStore.getState().openXroWorkspace("xro-1", "Checkout", "/tmp/xro-1");
		const again = useTabStore.getState().openXroWorkspace("xro-1", "Checkout", "/tmp/xro-1");

		expect(again.started).toBe(false);
		const terminals = useTabStore
			.getState()
			.getTabsByWorkspace("xro-1")
			.filter((t) => t.kind === "terminal");
		expect(terminals).toHaveLength(1);
	});

	test("re-open after closing only the coordinator terminal does not duplicate the canvas tab", () => {
		const first = useTabStore.getState().openXroWorkspace("xro-dup", "Dup", "/tmp/xro-dup");
		expect(first.started).toBe(true);

		// Close only the coordinator terminal tab
		useTabStore.getState().removeTab(first.terminalTabId);

		const second = useTabStore.getState().openXroWorkspace("xro-dup", "Dup", "/tmp/xro-dup");
		expect(second.started).toBe(true);

		// Collect all canvas tab ids across every pane of the xro-dup workspace
		const layout = usePaneStore.getState().layouts["xro-dup"];
		const allTabs = layout ? getAllPanes(layout).flatMap((p) => p.tabs) : [];
		const canvasIds = allTabs.filter((t) => t.kind === "xro-canvas").map((t) => t.id);

		// Exactly one canvas tab should exist with the correct id
		expect(canvasIds).toEqual(["xro-canvas-xro-dup"]);

		// The terminal tab for the new coordinator should also exist
		const terminals = allTabs.filter((t) => t.kind === "terminal");
		expect(terminals).toHaveLength(1);
		expect(second.terminalTabId).toBe(terminals[0]?.id);

		// ── Structural guard ─────────────────────────────────────────────────
		// Without the `if (!existingCanvas)` guard in openXroWorkspace, splitPane
		// is called on the surviving canvas pane, which produces a 2-pane split
		// layout (type "split") rather than a single flat pane.  Assert that the
		// surviving canvas and the new terminal tab both live in the SAME pane
		// (layout root is type "pane", not "split").
		expect(layout?.type).toBe("pane");

		// The single pane must contain both tabs; canvas first (it survived the
		// close), terminal second (just appended by the re-open).
		const panes = layout ? getAllPanes(layout) : [];
		expect(panes).toHaveLength(1);
		const singlePane = panes[0];
		expect(singlePane?.tabs.map((t) => t.kind)).toEqual(["xro-canvas", "terminal"]);
		expect(singlePane?.tabs.map((t) => t.id)).toEqual(["xro-canvas-xro-dup", second.terminalTabId]);
	});
});
