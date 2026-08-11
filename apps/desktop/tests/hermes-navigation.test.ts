import { beforeEach, describe, expect, test } from "bun:test";
import { useActionStore } from "../src/renderer/stores/action-store";
import { usePaneStore } from "../src/renderer/stores/pane-store";
import {
	PANEL_CLOSED,
	deserializeHermesSessionSelection,
	normalizeHermesSessionSelection,
	resolveAvailableHermesSelection,
	serializeHermesSessionSelection,
	shouldHydrateTabStore,
	useTabStore,
} from "../src/renderer/stores/tab-store";
import { hermesSessionCompositeIdentityKey } from "../src/shared/hermes";

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
		hermesSessionPane: "chat",
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
		expect(chat).toContain("HermesSessionTabStrip");
		expect(chat).toContain("HermesWorktreesPane");
		expect(chat).toContain("resolveHermesWorkspaceSessionId(sessionId, history.data)");
		expect(chat.match(/hermesSessionId: workspaceSessionId/g)).toHaveLength(3);
		expect(chat).not.toContain("Linked workspaces");
		expect(chat).toContain('label="Actions for selected agent session"');
		expect(chat).toMatch(
			/const origin = trpc\.hermes\.origin\.useQuery\([\s\S]*?enabled: Boolean\(connectionId && profileId && sessionId && connected\)/
		);
	});

	test("opening a linked workspace round-trips the exact session, Worktrees pane, and workspace", () => {
		const store = useTabStore.getState();
		const selection = { connectionId: "connection-b", sessionId: "duplicate-session" };
		store.selectHermesSession(selection);
		store.setHermesSessionPane("worktrees");
		store.openWorkspaceFromHermes(
			"workspace-1",
			"/repos/app-worktrees/feat",
			selection,
			"worktrees"
		);

		expect(useTabStore.getState().sidebarSegment).toBe("repos");
		expect(useTabStore.getState().activeWorkspaceId).toBe("workspace-1");
		expect(useTabStore.getState().canGoBackWorkspace()).toBe(true);
		expect(useTabStore.getState().workspaceBackStack.at(-1)).toEqual({
			kind: "hermes-session",
			...selection,
			pane: "worktrees",
		});

		useTabStore.getState().goBackWorkspace();
		expect(useTabStore.getState().sidebarSegment).toBe("hermes");
		expect(useTabStore.getState().selectedHermesSession).toEqual(selection);
		expect(useTabStore.getState().hermesSessionPane).toBe("worktrees");
		expect(useTabStore.getState().activeWorkspaceId).toBeNull();

		useTabStore.getState().goForwardWorkspace();
		expect(useTabStore.getState().sidebarSegment).toBe("repos");
		expect(useTabStore.getState().activeWorkspaceId).toBe("workspace-1");
	});

	test("defaults newly selected sessions to Chat without persisting pane state", () => {
		const store = useTabStore.getState();
		store.selectHermesSession({ connectionId: "connection-a", sessionId: "session-a" });
		store.setHermesSessionPane("worktrees");

		store.selectHermesSession({ connectionId: "connection-a", sessionId: "session-b" });

		expect(useTabStore.getState().hermesSessionPane).toBe("chat");
		expect(serializeHermesSessionSelection(useTabStore.getState().selectedHermesSession)).toBe(
			JSON.stringify({ connectionId: "connection-a", sessionId: "session-b" })
		);
	});

	test("keeps duplicate session IDs from two connections unambiguous in history", () => {
		const first = { connectionId: "connection-a", sessionId: "duplicate-session" };
		const second = { connectionId: "connection-b", sessionId: "duplicate-session" };
		const store = useTabStore.getState();
		store.selectHermesSession(first);
		store.openWorkspaceFromHermes("workspace-a", "/repos/a", first, "chat");
		store.selectHermesSession(second);
		store.openWorkspaceFromHermes("workspace-b", "/repos/b", second, "chat");

		useTabStore.getState().goBackWorkspace();
		expect(useTabStore.getState().selectedHermesSession).toEqual(second);
		expect(useTabStore.getState().selectedHermesSession).not.toEqual(first);
	});

	test("keeps duplicate session IDs from two profiles on one connection unambiguous", () => {
		const work = {
			connectionId: "connection-a",
			profileId: "work",
			sessionId: "duplicate-session",
		};
		const personal = {
			connectionId: "connection-a",
			profileId: "personal",
			sessionId: "duplicate-session",
		};
		useTabStore.getState().selectHermesSession(work);
		useTabStore.getState().openWorkspaceFromHermes("workspace-a", "/repos/a", work, "chat");
		useTabStore.getState().selectHermesSession(personal);
		useTabStore.getState().openWorkspaceFromHermes("workspace-b", "/repos/b", personal, "chat");

		useTabStore.getState().goBackWorkspace();
		expect(useTabStore.getState().selectedHermesSession).toEqual(personal);
		expect(useTabStore.getState().selectedHermesSession).not.toEqual(work);
	});

	test("builds collision-safe React keys from connection, profile, and durable session ID", () => {
		expect(hermesSessionCompositeIdentityKey("connection:a", "work", "session-1")).not.toBe(
			hermesSessionCompositeIdentityKey("connection", "a:work", "session-1")
		);
		expect(hermesSessionCompositeIdentityKey("connection-a", "work", "session-1")).toBe(
			JSON.stringify(["connection-a", "work", "session-1"])
		);
	});

	test("normalizes legacy selections only for a unique profile and fails closed on collisions", () => {
		const legacy = { connectionId: "connection-a", sessionId: "duplicate-session" };
		const work = {
			id: "duplicate-session",
			profileId: "work",
		};
		const personal = {
			id: "duplicate-session",
			profileId: "personal",
		};

		expect(normalizeHermesSessionSelection(legacy, [work])).toEqual({
			...legacy,
			profileId: "work",
		});
		expect(normalizeHermesSessionSelection(legacy, [work, personal])).toBeNull();
		expect(
			normalizeHermesSessionSelection({ ...legacy, profileId: "personal" }, [work, personal])
		).toEqual({ ...legacy, profileId: "personal" });
		expect(
			normalizeHermesSessionSelection({ ...legacy, profileId: "missing" }, [work, personal])
		).toBeNull();
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

	test("hydrates the exact Agents pane with no terminal sessions or workspace layouts", () => {
		const selection = { connectionId: "connection-restored", sessionId: "session-restored" };
		useTabStore.getState().hydrate([], null, null, "", {
			sidebarSegment: "hermes",
			selectedHermesSession: serializeHermesSessionSelection(selection) ?? "",
			hermesSessionPane: "worktrees",
		});

		expect(useTabStore.getState().sidebarSegment).toBe("hermes");
		expect(useTabStore.getState().selectedHermesSession).toEqual(selection);
		expect(useTabStore.getState().hermesSessionPane).toBe("worktrees");

		useTabStore.getState().hydrate([], null, null, "", {
			sidebarSegment: "hermes",
			selectedHermesSession: serializeHermesSessionSelection(selection) ?? "",
			hermesSessionPane: "unknown",
		});
		expect(useTabStore.getState().hermesSessionPane).toBe("chat");
	});

	test("keeps a hydrated selection while availability loads and safely drops missing targets", () => {
		const selection = { connectionId: "connection-a", sessionId: "session-a" };

		expect(resolveAvailableHermesSelection(selection, undefined, undefined)).toEqual(selection);
		expect(resolveAvailableHermesSelection(selection, ["connection-a"], undefined)).toEqual(
			selection
		);
		expect(resolveAvailableHermesSelection(selection, [], undefined)).toBeNull();
		expect(resolveAvailableHermesSelection(selection, ["connection-a"], [])).toBeNull();
		expect(resolveAvailableHermesSelection(selection, ["connection-a"], ["session-a"])).toEqual(
			selection
		);
	});

	test("forgets a permanently deleted Hermes session from selection and navigation history", () => {
		const deleted = { connectionId: "connection-a", sessionId: "session-deleted" };
		useTabStore.setState({
			selectedHermesSession: deleted,
			hermesSessionPane: "worktrees",
			workspaceBackStack: [
				{ kind: "hermes-session", ...deleted, pane: "chat" },
				{ kind: "workspace", id: "workspace-kept", cwd: "/repo/kept" },
			],
			workspaceForwardStack: [{ kind: "hermes-session", ...deleted, pane: "worktrees" }],
		});

		useTabStore.getState().forgetHermesSession(deleted);

		expect(useTabStore.getState().selectedHermesSession).toBeNull();
		expect(useTabStore.getState().hermesSessionPane).toBe("chat");
		expect(useTabStore.getState().workspaceBackStack).toEqual([
			{ kind: "workspace", id: "workspace-kept", cwd: "/repo/kept" },
		]);
		expect(useTabStore.getState().workspaceForwardStack).toEqual([]);
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
		expect(router).toContain("validateHermesOriginOpenUrl");
		expect(router).toContain("pickAttachments: publicProcedure");
		expect(router).toContain("releaseAttachment: publicProcedure");
		expect(router).toContain("setSessionArchived: publicProcedure");
		expect(router).toContain("deleteSession: publicProcedure");
		expect(router).toContain("hermesRuntimeService.setSessionArchived");
		expect(router).toContain("hermesRuntimeService.deleteSession");
		expect(router).toMatch(/attachmentHandles:\s*z\s*\.array/);
		expect(router).toContain("multiSelections");
		expect(router).not.toContain("bindingReleaseInput");
		expect(router).not.toContain("release: publicProcedure");
		expect(router).not.toContain("unbind: publicProcedure");
		expect(router).not.toContain("channelId:");
		expect(router).not.toContain("threadId:");
		expect(router).not.toContain("claimId");
	});

	test("offers passive history and explicit stock session/report actions without claim UI", async () => {
		const sidebar = await rendererSource("hermes/HermesSidebar.tsx");
		expect(sidebar).toContain("New agent session");
		expect(sidebar).toContain("trpc.hermes.create.useMutation");
		expect(sidebar).toContain("newTopic");
		expect(sidebar).toContain("newSessionSubmitting");
		expect(sidebar).not.toContain("availableWorkspaces");
		expect(sidebar).not.toContain("buildHermesTicketChoices");
		expect(sidebar).not.toContain("trpc.tickets.getCachedTickets.useQuery");
		expect(sidebar).not.toContain("trpc.tickets.getLinkedTickets.useQuery");
		expect(sidebar).not.toContain("newWorkspaceId");
		expect(sidebar).not.toContain("cwd:");
		expect(sidebar).toContain("Handovers");
		expect(sidebar).toContain("Sessions");
		expect(sidebar).toContain("showTokenInput");
		expect(sidebar).toContain("canSave");
		expect(sidebar).toContain("showAdvanced");
		expect(sidebar).toContain("Connect external Hermes");
		expect(sidebar).toContain("Local Hermes");
		expect(sidebar).toContain("Retry");
		expect(sidebar).toContain('role="alert"');
		expect(sidebar).toContain("retryFailedSessionAction");
		expect(sidebar).not.toContain('kind: "delete"');
		expect(sidebar).toContain("reconciliationRequired");
		expect(sidebar).toContain("Refresh session list");
		expect(sidebar).toMatch(
			/hermesSessionCompositeIdentityKey\(\s*connectionId \?\? "",\s*session\.profileId,\s*session\.id\s*\)/
		);
		expect(sidebar).toContain("profileId: session.profileId");
		expect(sidebar).not.toContain("onMutate:");
		expect(sidebar).not.toContain("Hermes connection");
		expect(sidebar).not.toContain("127.0.0.1:8080");
		expect(sidebar).not.toContain("token discovery failed");
		expect(sidebar).not.toContain('status.data?.status === "upgrade-required"');
		expect(sidebar).not.toContain("session.claimed");

		const view = await rendererSource("hermes/HermesSessionView.tsx");
		expect(view).toContain("Loading canonical Hermes history");
		expect(view).toContain("Preview Slack update");
		expect(view).toContain("Confirm send to Slack");
		expect(view).toContain("hermesReportRequiresExplicitRetry(reportState)");
		expect(view).toContain("Slack remains live. Continue sequentially");
		expect(view).not.toContain("HermesBindingLifecycle");
		expect(view).not.toContain("trpc.hermes.release.useMutation");
		expect(view).not.toContain("trpc.hermes.unbind");
		expect(view).not.toContain("Claiming and resuming");
		expect(view).not.toContain("trpc.hermes.registerAttachments.useMutation");
		expect(view).toContain("window.electron.hermesAttachments.begin");
		expect(view).toContain("window.electron.hermesAttachments.append");
		expect(view).toContain("window.electron.hermesAttachments.finish");
		expect(view).toContain("isHermesHistoryRevisionActivity(event, profileId, sessionId)");
		expect(view).toContain(
			"stageTransferredFiles(fileObjectsFromHermesTransfer(event.clipboardData))"
		);
		expect(view).toContain(
			"stageTransferredFiles(fileObjectsFromHermesTransfer(event.dataTransfer))"
		);
		expect(view).toContain("onPaste={handleChatPaste}");
		expect(view).toContain('event.dataTransfer.dropEffect = "copy"');
		expect(view).toContain('aria-label={live.running ? "Queue follow-up" : "Send message"}');
		expect(view).not.toContain("Use the paperclip");
		expect(view).toContain("new HermesHistorySyncCoordinator()");
		expect(view).toContain("historyRevision.errorUpdatedAt");
		expect(view).toContain("historySync.applyTail");
		expect(view).toContain("retry: false");
		expect(view).toMatch(
			/const next = historyRevision\.data;[\s\S]*?!next \|\|[\s\S]*?historyRevision\.error \|\|/
		);
		expect(view).not.toContain(
			"previousHistoryRevision.current = { selectionKey, revision: next }"
		);
	});

	test("keeps local workspace link polling active while Hermes is disconnected", async () => {
		const view = await rendererSource("hermes/HermesSessionView.tsx");
		const sidebar = await rendererSource("hermes/HermesSidebar.tsx");

		expect(view).toMatch(
			/workspaceLinks\.useQuery\([\s\S]*?enabled: Boolean\(connectionId && profileId && sessionId\), refetchInterval: 2_000/
		);
		expect(view).not.toContain("refetchInterval: connected ? 2_000 : false");
		expect(sidebar).toMatch(
			/workspaceLinkIndex\.useQuery\([\s\S]*?enabled: Boolean\(connectionId\), refetchInterval: 3_000/
		);
		expect(sidebar).toContain("hermesSessionIdentityKey(session.profileId, session.id)");
		expect(sidebar).not.toContain("refetchInterval: connected ? 3_000 : false");
	});

	test("flushes the selected composer draft when pane navigation hides Chat", async () => {
		const view = await rendererSource("hermes/HermesSessionView.tsx");

		expect(view).toMatch(
			/if \(activePane !== "chat" && draftIdentity\) hermesComposerDrafts\.flush\(draftIdentity\)/
		);
	});
});
