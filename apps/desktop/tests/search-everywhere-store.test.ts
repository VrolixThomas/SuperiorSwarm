import { beforeEach, describe, expect, test } from "bun:test";
import { useSearchEverywhereStore } from "../src/renderer/stores/search-everywhere-store";

function resetStore() {
	useSearchEverywhereStore.setState({ isOpen: false, activeTab: "all" });
}

describe("useSearchEverywhereStore", () => {
	beforeEach(resetStore);

	test("open shows the popup and resets the active tab to all", () => {
		useSearchEverywhereStore.getState().setActiveTab("text");

		useSearchEverywhereStore.getState().open();

		expect(useSearchEverywhereStore.getState().isOpen).toBe(true);
		expect(useSearchEverywhereStore.getState().activeTab).toBe("all");
	});

	test("toggle opens and closes the popup", () => {
		useSearchEverywhereStore.getState().toggle();
		expect(useSearchEverywhereStore.getState().isOpen).toBe(true);

		useSearchEverywhereStore.getState().toggle();
		expect(useSearchEverywhereStore.getState().isOpen).toBe(false);
	});

	test("setActiveTab changes the active tab", () => {
		useSearchEverywhereStore.getState().setActiveTab("symbols");

		expect(useSearchEverywhereStore.getState().activeTab).toBe("symbols");
	});

	test("cycleTab wraps forward and backward through search tabs", () => {
		useSearchEverywhereStore.getState().cycleTab(-1);
		expect(useSearchEverywhereStore.getState().activeTab).toBe("text");

		useSearchEverywhereStore.getState().cycleTab(1);
		expect(useSearchEverywhereStore.getState().activeTab).toBe("all");
	});
});
