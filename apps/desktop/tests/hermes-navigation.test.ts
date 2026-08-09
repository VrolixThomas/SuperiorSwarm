import { beforeEach, describe, expect, test } from "bun:test";
import { useActionStore } from "../src/renderer/stores/action-store";
import { usePaneStore } from "../src/renderer/stores/pane-store";
import {
	PANEL_CLOSED,
	deserializeHermesSessionSelection,
	serializeHermesSessionSelection,
	shouldHydrateTabStore,
	useTabStore,
} from "../src/renderer/stores/tab-store";

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

async function mainSource(path: string): Promise<string> {
	return await Bun.file(new URL(`../src/main/${path}`, import.meta.url)).text();
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
		selectedHermesSession: null,
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
		useTabStore.setState({
			selectedHermesSession: { connectionId: "connection-a", sessionId: "session-42" },
		});
		registerCoreActions();

		useActionStore.getState().execute("nav.hermes");

		expect(useTabStore.getState().sidebarSegment).toBe("hermes");
		expect(useTabStore.getState().selectedHermesSession).toEqual({
			connectionId: "connection-a",
			sessionId: "session-42",
		});
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
		expect(chat).toContain('const connectionId = selection?.connectionId ?? ""');
		expect(chat).not.toContain("connections.data?.[0]");
	});

	test("opening a linked workspace and going Back returns to the exact connection and session", () => {
		const store = useTabStore.getState();
		const selection = { connectionId: "connection-b", sessionId: "duplicate-session" };
		store.selectHermesSession(selection);
		store.openWorkspaceFromHermes("workspace-1", "/repos/app-worktrees/feat", selection);

		expect(useTabStore.getState().sidebarSegment).toBe("repos");
		expect(useTabStore.getState().activeWorkspaceId).toBe("workspace-1");
		expect(useTabStore.getState().canGoBackWorkspace()).toBe(true);

		useTabStore.getState().goBackWorkspace();
		expect(useTabStore.getState().sidebarSegment).toBe("hermes");
		expect(useTabStore.getState().selectedHermesSession).toEqual(selection);
		expect(useTabStore.getState().activeWorkspaceId).toBeNull();

		useTabStore.getState().goForwardWorkspace();
		expect(useTabStore.getState().sidebarSegment).toBe("repos");
		expect(useTabStore.getState().activeWorkspaceId).toBe("workspace-1");
	});

	test("keeps duplicate session IDs from two connections unambiguous in history", () => {
		const first = { connectionId: "connection-a", sessionId: "duplicate-session" };
		const second = { connectionId: "connection-b", sessionId: "duplicate-session" };
		const store = useTabStore.getState();
		store.selectHermesSession(first);
		store.openWorkspaceFromHermes("workspace-a", "/repos/a", first);
		store.selectHermesSession(second);
		store.openWorkspaceFromHermes("workspace-b", "/repos/b", second);

		useTabStore.getState().goBackWorkspace();
		expect(useTabStore.getState().selectedHermesSession).toEqual(second);
		expect(useTabStore.getState().selectedHermesSession).not.toEqual(first);
	});

	test("clears a selected session when the active connection changes", () => {
		useTabStore.getState().selectHermesSession({
			connectionId: "connection-a",
			sessionId: "duplicate-session",
		});

		useTabStore.getState().changeHermesConnection("connection-b");

		expect(useTabStore.getState().selectedHermesSession).toBeNull();
	});

	test("hydrates the global Hermes route without requiring a workspace", () => {
		const serialized = serializeHermesSessionSelection({
			connectionId: "connection-restored",
			sessionId: "session-restored",
		});
		expect(
			shouldHydrateTabStore(false, false, {
				sidebarSegment: "hermes",
				selectedHermesSession: serialized ?? "",
			})
		).toBe(true);
		useTabStore.getState().hydrate([], null, "workspace-from-last-run", "/repos/old", {
			sidebarSegment: "hermes",
			selectedHermesSession: serialized ?? "",
		});

		expect(useTabStore.getState().sidebarSegment).toBe("hermes");
		expect(useTabStore.getState().selectedHermesSession).toEqual({
			connectionId: "connection-restored",
			sessionId: "session-restored",
		});
		expect(deserializeHermesSessionSelection(serialized)).toEqual(
			useTabStore.getState().selectedHermesSession
		);
		expect(useTabStore.getState().activeWorkspaceId).toBeNull();
		expect(useTabStore.getState().activeWorkspaceCwd).toBe("");
	});

	test("drops legacy session-only persistence because its connection is ambiguous", () => {
		useTabStore.getState().hydrate([], null, null, "", {
			sidebarSegment: "hermes",
			selectedHermesSessionId: "duplicate-session",
		});

		expect(useTabStore.getState().selectedHermesSession).toBeNull();
	});

	test("keeps stock lifecycle and Slack destinations behind the main-process router", async () => {
		const router = await mainSource("trpc/routers/hermes.ts");
		expect(router).toContain("create: publicProcedure");
		expect(router).toContain("topic: z.string().trim().min(1)");
		expect(router).toContain("messageId: z.string().min(1)");
		expect(router).toContain("explicitRetry: z.boolean()");
		expect(router).toContain("saveOriginLink");
		expect(router).not.toContain("bindingReleaseInput");
		expect(router).not.toContain("release: publicProcedure");
		expect(router).not.toContain("unbind: publicProcedure");
		expect(router).not.toContain("channelId:");
		expect(router).not.toContain("threadId:");
		expect(router).not.toContain("claimId");
	});

	test("offers passive history and explicit stock session/report actions without claim UI", async () => {
		const sidebar = await rendererSource("hermes/HermesSidebar.tsx");
		expect(sidebar).toContain("New session");
		expect(sidebar).toContain("trpc.hermes.create.useMutation");
		expect(sidebar).toContain("newTopic");
		expect(sidebar).toContain("newSessionSubmitting");
		expect(sidebar).toContain("trpc.tickets.getCachedTickets.useQuery");
		expect(sidebar).toContain("trpc.tickets.getLinkedTickets.useQuery");
		expect(sidebar).toContain("showTokenInput");
		expect(sidebar).toContain("canSave");
		expect(sidebar).not.toContain('status.data?.status === "upgrade-required"');
		expect(sidebar).not.toContain("session.claimed");

		const view = await rendererSource("hermes/HermesSessionView.tsx");
		expect(view).toContain("Loading canonical Hermes history");
		expect(view).toContain("Preview Slack update");
		expect(view).toContain("Confirm send to Slack");
		expect(view).toContain("Slack remains live; continue sequentially");
		expect(view).not.toContain("HermesBindingLifecycle");
		expect(view).not.toContain("trpc.hermes.release");
		expect(view).not.toContain("trpc.hermes.unbind");
		expect(view).not.toContain("Claiming and resuming");
	});
});
