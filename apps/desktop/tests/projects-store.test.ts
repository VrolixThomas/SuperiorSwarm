import { beforeEach, describe, expect, test } from "bun:test";
import { useProjectStore } from "../src/renderer/stores/projects";

describe("useProjectStore — settings", () => {
	beforeEach(() => {
		useProjectStore.setState({
			sidebarView: "main",
			settingsCategory: "general",
		});
	});

	test("defaults to settingsCategory: general", () => {
		expect(useProjectStore.getState().settingsCategory).toBe("general");
	});

	test("setSettingsCategory updates the category", () => {
		useProjectStore.getState().setSettingsCategory("integrations");
		expect(useProjectStore.getState().settingsCategory).toBe("integrations");
	});

	test("accepts lsp category", () => {
		useProjectStore.getState().setSettingsCategory("lsp");
		expect(useProjectStore.getState().settingsCategory).toBe("lsp");
	});

	test("openSettings resets category to general", () => {
		useProjectStore.getState().setSettingsCategory("ai-review");
		useProjectStore.getState().openSettings();
		expect(useProjectStore.getState().sidebarView).toBe("settings");
		expect(useProjectStore.getState().settingsCategory).toBe("general");
	});

	test("closeSettings returns to main view", () => {
		useProjectStore.getState().openSettings();
		useProjectStore.getState().closeSettings();
		expect(useProjectStore.getState().sidebarView).toBe("main");
	});
});
