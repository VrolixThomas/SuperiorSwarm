import { beforeEach, describe, expect, test } from "bun:test";
import { usePaneStore } from "../src/renderer/stores/pane-store";
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
});
