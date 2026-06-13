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

describe("orchestrator pane state", () => {
	beforeEach(() => {
		useProjectStore.getState().setOrchestratorPaneHeight(180);
		useProjectStore.getState().setOrchestratorPaneCollapsed(false);
	});

	test("defaults", () => {
		const s = useProjectStore.getState();
		expect(s.orchestratorPaneHeight).toBe(180);
		expect(s.orchestratorPaneCollapsed).toBe(false);
	});

	test("setOrchestratorPaneHeight updates height", () => {
		useProjectStore.getState().setOrchestratorPaneHeight(240);
		expect(useProjectStore.getState().orchestratorPaneHeight).toBe(240);
	});

	test("toggleOrchestratorPaneCollapsed flips the flag", () => {
		const before = useProjectStore.getState().orchestratorPaneCollapsed;
		useProjectStore.getState().toggleOrchestratorPaneCollapsed();
		expect(useProjectStore.getState().orchestratorPaneCollapsed).toBe(!before);
		useProjectStore.getState().toggleOrchestratorPaneCollapsed();
		expect(useProjectStore.getState().orchestratorPaneCollapsed).toBe(before);
	});
});
