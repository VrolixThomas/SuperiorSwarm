import { beforeEach, describe, expect, test } from "bun:test";
import { useActionStore } from "../src/renderer/stores/action-store";
import { usePaneStore } from "../src/renderer/stores/pane-store";
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

async function rendererSource(path: string): Promise<string> {
	return await Bun.file(new URL(`../src/renderer/components/${path}`, import.meta.url)).text();
}

function resetStores() {
	useActionStore.setState({ actions: new Map(), isPaletteOpen: false });
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

	test("registers Agents as the visible fourth top-level navigation item", async () => {
		registerCoreActions();

		const action = useActionStore.getState().actions.get("nav.hermes");
		expect(action?.label).toBe("Agents");
		expect(action?.shortcut).toEqual({ key: "4", meta: true });

		const sidebar = await rendererSource("Sidebar.tsx");
		expect(sidebar).toContain('["repos", "tickets", "prs", "hermes"]');
		expect(sidebar).toContain('hermes: "Agents"');
		expect(sidebar).not.toContain('hermes: "Hermes"');

		const rail = await rendererSource("SidebarRail.tsx");
		expect(rail).toContain('title="Agents"');
		expect(rail).toMatch(/onExpand\("hermes"\)[\s\S]*?>\s*A\s*<\/button>/);
	});

	test("the Agents route keeps agent threads in the sidebar and chat in the main area", async () => {
		useTabStore.getState().setActiveWorkspace("workspace-1", "/repos/app-worktrees/feat");
		useTabStore.setState({ selectedHermesSessionId: "session-42" });
		registerCoreActions();

		useActionStore.getState().execute("nav.hermes");

		expect(useTabStore.getState().sidebarSegment).toBe("hermes");
		expect(useTabStore.getState().selectedHermesSessionId).toBe("session-42");
		expect(useTabStore.getState().activeWorkspaceId).toBeNull();
		expect(useTabStore.getState().activeWorkspaceCwd).toBe("");

		const sidebar = await rendererSource("Sidebar.tsx");
		expect(sidebar).toContain('{segment === "hermes" && <HermesSidebar />}');

		const main = await rendererSource("MainContentArea.tsx");
		const agentRoute = main.indexOf('if (sidebarSegment === "hermes")');
		const workspaceRoute = main.indexOf("if (!activeWorkspaceId || !layout)");
		expect(agentRoute).toBeGreaterThan(-1);
		expect(workspaceRoute).toBeGreaterThan(agentRoute);
		expect(main.slice(agentRoute, workspaceRoute)).toContain("return <HermesSessionView />");

		const chat = await rendererSource("hermes/HermesSessionView.tsx");
		expect(chat).toContain("Select an agent thread");
		expect(chat).not.toContain("Select a Hermes session");
	});

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
