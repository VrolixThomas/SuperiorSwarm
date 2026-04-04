import { beforeEach, describe, expect, test } from "bun:test";
import { useBranchStore } from "../src/renderer/stores/branch-store";

function resetStore() {
	useBranchStore.setState({
		isPaletteOpen: false,
		searchQuery: "",
		selectedIndex: 0,
		actionMenuBranch: null,
		mergeState: null,
	});
}

describe("palette state", () => {
	beforeEach(resetStore);

	test("opens and closes palette", () => {
		useBranchStore.getState().openPalette();
		expect(useBranchStore.getState().isPaletteOpen).toBe(true);

		useBranchStore.getState().closePalette();
		expect(useBranchStore.getState().isPaletteOpen).toBe(false);
	});

	test("closePalette resets search and selection", () => {
		const store = useBranchStore.getState();
		store.openPalette();
		store.setSearchQuery("test");
		store.setSelectedIndex(5);
		store.closePalette();

		const state = useBranchStore.getState();
		expect(state.searchQuery).toBe("");
		expect(state.selectedIndex).toBe(0);
	});

	test("toggles action menu for a branch", () => {
		const store = useBranchStore.getState();
		store.openActionMenu("main");
		expect(useBranchStore.getState().actionMenuBranch).toBe("main");

		store.closeActionMenu();
		expect(useBranchStore.getState().actionMenuBranch).toBeNull();
	});
});

describe("merge state", () => {
	beforeEach(resetStore);

	test("sets and clears merge state", () => {
		const store = useBranchStore.getState();
		store.setMergeState({
			type: "merge",
			sourceBranch: "main",
			targetBranch: "feature/x",
			conflicts: [{ path: "file.txt", status: "conflicting" }],
			activeFilePath: "file.txt",
			rebaseProgress: null,
		});

		const state = useBranchStore.getState();
		expect(state.mergeState).not.toBeNull();
		expect(state.mergeState?.sourceBranch).toBe("main");

		store.clearMergeState();
		expect(useBranchStore.getState().mergeState).toBeNull();
	});

	test("marks a file as resolved", () => {
		const store = useBranchStore.getState();
		store.setMergeState({
			type: "merge",
			sourceBranch: "main",
			targetBranch: "feature/x",
			conflicts: [
				{ path: "a.txt", status: "conflicting" },
				{ path: "b.txt", status: "conflicting" },
			],
			activeFilePath: "a.txt",
			rebaseProgress: null,
		});

		store.markFileResolved("a.txt");
		const conflicts = useBranchStore.getState().mergeState?.conflicts;
		const resolved = conflicts?.find((f) => f.path === "a.txt");
		expect(resolved?.status).toBe("resolved");
	});

	test("sets active conflict file", () => {
		const store = useBranchStore.getState();
		store.setMergeState({
			type: "merge",
			sourceBranch: "main",
			targetBranch: "feature/x",
			conflicts: [{ path: "a.txt", status: "conflicting" }],
			activeFilePath: null,
			rebaseProgress: null,
		});

		store.setActiveConflictFile("a.txt");
		expect(useBranchStore.getState().mergeState?.activeFilePath).toBe("a.txt");
	});
});
