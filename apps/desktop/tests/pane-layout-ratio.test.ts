import { expect, test } from "bun:test";
import { ratioFromPanelLayout } from "../src/renderer/lib/pane-layout-ratio";
import { usePaneStore } from "../src/renderer/stores/pane-store";
test("resize completion persists library panel-ID percentages for a workspace split", () => {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	const pane = usePaneStore.getState().ensureLayout("workspace");
	usePaneStore.getState().splitPane("workspace", pane.id, "horizontal");
	const root = usePaneStore.getState().getLayout("workspace");
	if (!root || root.type !== "split") throw new Error("Missing split");
	const ratio = ratioFromPanelLayout(root.id, {
		[`${root.id}-first`]: 67.5,
		[`${root.id}-second`]: 32.5,
	});
	expect(ratio).toBe(0.675);
	if (ratio !== null) usePaneStore.getState().setPaneRatio("workspace", root.id, ratio);
	expect(usePaneStore.getState().getLayout("workspace")).toMatchObject({ ratio: 0.675 });
	expect(
		ratioFromPanelLayout(root.id, { "unrelated-first": 60, "unrelated-second": 40 })
	).toBeNull();
	expect(
		ratioFromPanelLayout(root.id, { [`${root.id}-first`]: Number.NaN, [`${root.id}-second`]: 40 })
	).toBeNull();
});
