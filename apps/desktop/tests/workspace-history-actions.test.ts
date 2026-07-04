import { beforeEach, describe, expect, test } from "bun:test";
import { useActionStore } from "../src/renderer/stores/action-store";
import { PANEL_CLOSED, useTabStore } from "../src/renderer/stores/tab-store";

(globalThis as typeof globalThis & { matchMedia: typeof matchMedia }).matchMedia = () =>
	({
		matches: false,
		addEventListener: () => {},
		removeEventListener: () => {},
	}) as unknown as MediaQueryList;

(globalThis as unknown as { window: unknown }).window = {
	electron: {
		settings: {
			onThemeChanged: () => undefined,
		},
	},
};

const { registerCoreActions } = await import("../src/renderer/actions/core-actions");

function resetStores() {
	useActionStore.setState({
		actions: new Map(),
		isPaletteOpen: false,
	});
	useTabStore.setState({
		activeWorkspaceId: null,
		activeWorkspaceCwd: "",
		workspaceBackStack: [],
		workspaceForwardStack: [],
		pendingWorkspaceHistoryEntry: null,
		rightPanel: PANEL_CLOSED,
		workspaceMetadata: {},
		sidebarSegment: "repos",
		activeWorkspaceBySegment: { repos: null, tickets: null, prs: null },
	});
}

describe("workspace history actions", () => {
	beforeEach(resetStores);

	test("registers back and forward navigation shortcuts", () => {
		registerCoreActions();

		const back = useActionStore.getState().actions.get("nav.workspaceBack");
		const forward = useActionStore.getState().actions.get("nav.workspaceForward");

		expect(back?.label).toBe("Go Back");
		expect(back?.shortcut).toEqual({ key: "BracketLeft", meta: true });
		expect(forward?.label).toBe("Go Forward");
		expect(forward?.shortcut).toEqual({ key: "BracketRight", meta: true });
	});

	test("executes workspace history navigation", () => {
		useTabStore.getState().setActiveWorkspace("ws-a", "/repo/a");
		useTabStore.getState().setActiveWorkspace("ws-b", "/repo/b");
		registerCoreActions();

		useActionStore.getState().execute("nav.workspaceBack");
		expect(useTabStore.getState().activeWorkspaceId).toBe("ws-a");

		useActionStore.getState().execute("nav.workspaceForward");
		expect(useTabStore.getState().activeWorkspaceId).toBe("ws-b");
	});
});
