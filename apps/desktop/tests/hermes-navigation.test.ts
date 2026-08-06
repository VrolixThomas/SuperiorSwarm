import { beforeEach, describe, expect, test } from "bun:test";
import { usePaneStore } from "../src/renderer/stores/pane-store";
import { PANEL_CLOSED, useTabStore } from "../src/renderer/stores/tab-store";

function resetStores() {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	useTabStore.setState({
		activeWorkspaceId: null,
		activeWorkspaceCwd: "",
		workspaceBackStack: [],
		workspaceForwardStack: [],
		pendingWorkspaceHistoryEntry: null,
		rightPanel: PANEL_CLOSED,
		workspaceMetadata: {},
		sidebarSegment: "repos",
		activeWorkspaceBySegment: { repos: null, tickets: null, prs: null, hermes: null },
		selectedHermesSessionId: null,
	});
}

describe("Hermes global navigation", () => {
	beforeEach(resetStores);

	test("opening a linked workspace and going Back returns to the exact Hermes session", () => {
		const store = useTabStore.getState();
		store.selectHermesSession("session-42");
		store.openWorkspaceFromHermes("workspace-1", "/repos/app-worktrees/feat", "session-42");

		expect(useTabStore.getState().sidebarSegment).toBe("repos");
		expect(useTabStore.getState().activeWorkspaceId).toBe("workspace-1");
		expect(useTabStore.getState().canGoBackWorkspace()).toBe(true);

		useTabStore.getState().goBackWorkspace();
		expect(useTabStore.getState().sidebarSegment).toBe("hermes");
		expect(useTabStore.getState().selectedHermesSessionId).toBe("session-42");
		expect(useTabStore.getState().activeWorkspaceId).toBeNull();

		useTabStore.getState().goForwardWorkspace();
		expect(useTabStore.getState().sidebarSegment).toBe("repos");
		expect(useTabStore.getState().activeWorkspaceId).toBe("workspace-1");
	});

	test("hydrates the global Hermes route without requiring a workspace", () => {
		useTabStore.getState().hydrate([], null, "workspace-from-last-run", "/repos/old", {
			sidebarSegment: "hermes",
			selectedHermesSessionId: "session-restored",
		});

		expect(useTabStore.getState().sidebarSegment).toBe("hermes");
		expect(useTabStore.getState().selectedHermesSessionId).toBe("session-restored");
		expect(useTabStore.getState().activeWorkspaceId).toBeNull();
		expect(useTabStore.getState().activeWorkspaceCwd).toBe("");
	});
});
