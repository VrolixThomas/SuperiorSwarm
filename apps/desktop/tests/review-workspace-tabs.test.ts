import { beforeEach, expect, test } from "bun:test";
import { closeTabWithTerminalCleanup } from "../src/renderer/lib/pane-lifecycle";
import { createDefaultPane, getAllPanes, usePaneStore } from "../src/renderer/stores/pane-store";
import { useTabStore } from "../src/renderer/stores/tab-store";
import type { PRContext } from "../src/shared/github-types";

function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) throw new Error("Expected fixture value");
	return value;
}

const prCtx: PRContext = {
	provider: "bitbucket",
	owner: "owner",
	repo: "repo",
	number: 12,
	repoPath: "/repo",
	title: "Example",
	sourceBranch: "feature",
	targetBranch: "main",
};
beforeEach(() => {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	useTabStore.setState({ workspaceMetadata: {}, activeWorkspaceId: null, activeWorkspaceCwd: "" });
});
test("Review is pinned, idempotent, and can be manually moved", () => {
	const tabs = useTabStore.getState();
	const id = tabs.ensureReviewTab("a", prCtx);
	expect(tabs.ensureReviewTab("a", prCtx)).toBe(id);
	const pane = required(usePaneStore.getState().findPaneForTab("a", id));
	closeTabWithTerminalCleanup("a", pane.id, id);
	expect(tabs.getTabsByWorkspace("a")).toHaveLength(1);
	const other = usePaneStore.getState().splitPane("a", pane.id, "horizontal");
	usePaneStore.getState().moveTabBetweenPanes("a", pane.id, other, id);
	expect(usePaneStore.getState().findPaneForTab("a", id)?.id).toBe(other);
});
test("Closing a pane rehomes Review and automatic split keeps it left", () => {
	const tabs = useTabStore.getState();
	const id = tabs.ensureReviewTab("a", prCtx);
	const pane = required(usePaneStore.getState().findPaneForTab("a", id));
	const agent = tabs.ensureReviewAgentTab({
		id: "job",
		identity: { workspaceId: "a" },
		agent: { label: "Codex" },
	});
	usePaneStore.getState().setActiveTabInPane("a", pane.id, id);
	const other = usePaneStore.getState().splitPaneForCommand("a", pane.id, "horizontal");
	expect(usePaneStore.getState().findPaneForTab("a", id)?.id).toBe(pane.id);
	expect(usePaneStore.getState().findPaneForTab("a", agent)?.id).toBe(other);
	expect(usePaneStore.getState().getLayout("a")).toMatchObject({ ratio: 0.6 });
	usePaneStore.getState().closePane("a", pane.id);
	expect(tabs.getTabsByWorkspace("a").filter((t) => t.kind === "pr-review")).toHaveLength(1);
});
test("background job registration does not change active workspace, pane, or tab", () => {
	const tabs = useTabStore.getState();
	tabs.ensureReviewTab("a", prCtx);
	tabs.setActiveWorkspace("b", "/b");
	const shell = tabs.addTerminalTab("b", "/b");
	const focused = usePaneStore.getState().focusedPaneId;
	tabs.ensureReviewAgentTab({
		id: "job",
		identity: { workspaceId: "a" },
		agent: { label: "Codex" },
	});
	expect(useTabStore.getState().activeWorkspaceId).toBe("b");
	expect(usePaneStore.getState().focusedPaneId).toBe(focused);
	expect(usePaneStore.getState().getFocusedPane("b")?.activeTabId).toBe(shell);
	expect(getAllPanes(required(usePaneStore.getState().getLayout("a")))[0]?.activeTabId).toBe(
		"pr-review:a"
	);
});
test("logical review workspaces reject ordinary shells until isolated path exists", () => {
	const tabs = useTabStore.getState();
	tabs.setWorkspaceMetadata("a", { type: "review" });
	expect(tabs.addTerminalTab("a", "/main-checkout")).toBe("");
	tabs.setWorkspaceMetadata("a", { type: "review", reviewWorktreePath: "/isolated" });
	const id = tabs.addTerminalTab("a", "/main-checkout");
	expect(tabs.getTabsByWorkspace("a").find((t) => t.id === id)).toMatchObject({ cwd: "/isolated" });
});
test("hydrate upgrades old attached terminals without creating or duplicating a PTY", () => {
	const legacy = {
		kind: "terminal" as const,
		id: "review-path:run-123:1",
		workspaceId: "a",
		title: "Codex",
		cwd: "/isolated",
	};
	usePaneStore.getState().hydrateLayout("a", createDefaultPane([legacy, legacy]));
	const tabs = useTabStore.getState().getTabsByWorkspace("a");
	expect(tabs).toHaveLength(1);
	expect(tabs[0]).toMatchObject({
		kind: "review-agent",
		jobId: "legacy:run-123",
		terminalId: legacy.id,
		cwd: legacy.cwd,
	});
});

test("manual edge drag moves Review and cannot move it into another workspace", () => {
	const tabs = useTabStore.getState();
	const id = tabs.ensureReviewTab("a", prCtx);
	const agent = tabs.ensureReviewAgentTab({
		id: "job",
		identity: { workspaceId: "a" },
		agent: { label: "Codex" },
	});
	const pane = required(usePaneStore.getState().findPaneForTab("a", id));
	usePaneStore.getState().dropTabOnEdge("a", pane.id, pane.id, id, "right");
	const layout = required(usePaneStore.getState().getLayout("a"));
	expect(layout.type).toBe("split");
	expect(getAllPanes(layout)[1]?.tabs[0]?.id).toBe(id);
	const foreign = usePaneStore.getState().ensureLayout("b");
	usePaneStore
		.getState()
		.moveTabBetweenPanes("a", required(getAllPanes(layout)[1]).id, foreign.id, id);
	expect(tabs.getTabsByWorkspace("a").some((t) => t.id === id)).toBe(true);
	expect(tabs.getTabsByWorkspace("b")).toHaveLength(0);
	tabs.revealReviewAgentTab("a", { jobId: "job", beside: true });
	const arranged = required(usePaneStore.getState().getLayout("a"));
	expect(arranged).toMatchObject({ direction: "horizontal", ratio: 0.6 });
	expect(getAllPanes(arranged)[0]?.activeTabId).toBe(id);
	expect(getAllPanes(arranged)[1]?.activeTabId).toBe(agent);
});

test("closing an agent view detaches only; ordinary shells dispose", () => {
	const disposed: string[] = [];
	const scope = globalThis as typeof globalThis & {
		electron?: { terminal: { dispose: (id: string) => Promise<void> } };
	};
	const previous = scope.electron;
	scope.electron = {
		terminal: {
			dispose: async (id) => {
				disposed.push(id);
			},
		},
	};
	try {
		const tabs = useTabStore.getState();
		tabs.ensureReviewTab("a", prCtx);
		const id = tabs.ensureReviewAgentTab({
			id: "job",
			identity: { workspaceId: "a" },
			agent: { label: "Codex" },
			terminalId: "review-path:run:1",
			cwd: "/isolated",
		});
		const pane = required(usePaneStore.getState().findPaneForTab("a", id));
		closeTabWithTerminalCleanup("a", pane.id, id);
		expect(disposed).toEqual([]);
		expect(tabs.isReviewAgentTabHidden("a", "job")).toBe(true);
		tabs.setWorkspaceMetadata("a", {
			...useTabStore.getState().workspaceMetadata["a"],
			type: "review",
			reviewWorktreePath: "/isolated",
		});
		const shell = tabs.addTerminalTab("a", "/isolated");
		closeTabWithTerminalCleanup("a", pane.id, shell);
		expect(disposed).toEqual([shell]);
	} finally {
		scope.electron = previous;
	}
});

test("keyboard split and close use the same pinned Review behavior", async () => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
	const originalMatchMedia = globalThis.matchMedia;
	globalThis.matchMedia = () =>
		({
			matches: false,
			addEventListener: () => {},
			removeEventListener: () => {},
		}) as unknown as MediaQueryList;
	const { registerCoreActions } = await import("../src/renderer/actions/core-actions");
	const { useActionStore } = await import("../src/renderer/stores/action-store");
	globalThis.matchMedia = originalMatchMedia;
	if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
	else Reflect.deleteProperty(globalThis, "window");
	registerCoreActions();
	const tabs = useTabStore.getState();
	tabs.activateReviewWorkspace("a", "/repo", prCtx);
	const id = tabs.ensureReviewAgentTab({
		id: "job",
		identity: { workspaceId: "a" },
		agent: { label: "Codex" },
	});
	const reviewPane = required(usePaneStore.getState().findPaneForTab("a", "pr-review:a"));
	usePaneStore.getState().setFocusedPane(reviewPane.id);
	useActionStore.getState().execute("terminal.closeTab");
	expect(tabs.getTabsByWorkspace("a").some((t) => t.kind === "pr-review")).toBe(true);
	useActionStore.getState().execute("pane.splitRight");
	const layout = required(usePaneStore.getState().getLayout("a"));
	expect(layout).toMatchObject({ ratio: 0.6, direction: "horizontal" });
	expect(getAllPanes(layout)[0]?.activeTabId).toBe("pr-review:a");
	expect(getAllPanes(layout)[1]?.activeTabId).toBe(id);
	useActionStore.getState().execute("terminal.new");
	expect(tabs.getTabsByWorkspace("a").filter((t) => t.kind === "terminal")).toHaveLength(0);
});

test("serialized tabs restore Review and the same attached agent without relaunch", async () => {
	const { deserializeLayout, collectSessionSnapshot } = await import(
		"../src/renderer/session-snapshot"
	);
	const tabs = useTabStore.getState();
	tabs.ensureReviewTab("a", prCtx);
	const id = tabs.ensureReviewAgentTab({
		id: "job",
		identity: { workspaceId: "a" },
		agent: { label: "Codex" },
		terminalId: "review-path:run:1",
		cwd: "/isolated",
	});
	tabs.revealReviewAgentTab("a", { jobId: "job", beside: true });
	const snapshot = collectSessionSnapshot();
	expect(snapshot.sessions[0]?.id).toBe("review-path:run:1");
	const restored = deserializeLayout(JSON.parse(required(snapshot.paneLayouts["a"])), new Map());
	expect(restored).toBeTruthy();
	expect(
		getAllPanes(required(restored))
			.flatMap((p) => p.tabs)
			.map((t) => t.kind)
	).toEqual(["pr-review", "review-agent"]);
	expect(getAllPanes(required(restored))[1]?.activeTabId).toBe(id);
});

test("hidden agent views survive session restore and explicit reopening clears the preference", async () => {
	const { collectSessionSnapshot } = await import("../src/renderer/session-snapshot");
	const tabs = useTabStore.getState();
	const job = { id: "job", identity: { workspaceId: "a" }, agent: { label: "Codex" } };
	tabs.activateReviewWorkspace("a", "/repo", prCtx);
	const id = tabs.ensureReviewAgentTab(job);
	const pane = usePaneStore.getState().findPaneForTab("a", id);
	if (!pane) throw new Error("Missing agent pane");
	closeTabWithTerminalCleanup("a", pane.id, id);
	const snapshot = collectSessionSnapshot();
	tabs.hydrate([], null, "a", "/repo", snapshot.state);
	expect(tabs.isReviewAgentTabHidden("a", "job")).toBe(true);
	tabs.ensureReviewAgentTab(job);
	expect(tabs.isReviewAgentTabHidden("a", "job")).toBe(false);
});

test("a hidden agent PTY retained by the daemon is not resurrected during hydration", async () => {
	const { collectSessionSnapshot } = await import("../src/renderer/session-snapshot");
	const tabs = useTabStore.getState();
	tabs.activateReviewWorkspace("a", "/repo", prCtx);
	const job = {
		id: "job",
		identity: { workspaceId: "a" },
		agent: { label: "Codex" },
		terminalId: "review-path:run:1",
		cwd: "/isolated",
	};
	const id = tabs.ensureReviewAgentTab(job);
	const pane = usePaneStore.getState().findPaneForTab("a", id);
	if (!pane) throw new Error("Missing agent pane");
	closeTabWithTerminalCleanup("a", pane.id, id);
	const snapshot = collectSessionSnapshot();
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	tabs.hydrate(
		[{ id: job.terminalId, workspaceId: "a", title: "Codex", cwd: job.cwd }],
		null,
		"a",
		"/repo",
		snapshot.state
	);
	expect(tabs.getTabsByWorkspace("a").filter((t) => t.kind === "review-agent")).toHaveLength(0);
	expect(tabs.isReviewAgentTabHidden("a", "job")).toBe(true);
});

test("a new solve review is registered before splitting without disturbing its agent terminal", () => {
	const tabs = useTabStore.getState();
	tabs.setActiveWorkspace("solve-workspace", "/solve");
	const terminal = tabs.addTerminalTab("solve-workspace", "/solve", "Solver", "solver-terminal");
	const first = required(usePaneStore.getState().findPaneForTab("solve-workspace", terminal));
	const review = tabs.addSolveReviewTab("solve-workspace", "solve-session", { split: true });
	const layout = required(usePaneStore.getState().getLayout("solve-workspace"));
	const panes = getAllPanes(layout);
	expect(panes).toHaveLength(2);
	expect(panes[0]?.id).toBe(first.id);
	expect(panes[0]?.activeTabId).toBe(terminal);
	expect(panes[1]?.activeTabId).toBe(review);
	expect(
		tabs
			.getTabsByWorkspace("solve-workspace")
			.map((tab) => tab.id)
			.sort()
	).toEqual([review, terminal].sort());
});

test("Queue publication origin survives browser and job tabs plus sidebar return", async () => {
	const { openBrowserTab } = await import("../src/renderer/browser/lifecycle");
	const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
	const tabs = useTabStore.getState();
	tabs.activateReviewWorkspace("queue-review", "/repo", prCtx, "attach-existing-only");
	const origin = { id: "queue-pr", revision: 7, workspaceId: "queue-review" };
	useReviewModeStore.getState().setQueueOrigin(origin);
	const browser = openBrowserTab("queue-review", "https://example.com/docs", "browser-docs");
	const job = tabs.ensureReviewAgentTab({
		id: "job",
		identity: { workspaceId: "queue-review" },
		agent: { label: "Codex" },
		terminalId: "review-path:run:1",
		cwd: "/isolated",
	});
	tabs.setActiveTab(job);
	tabs.setActiveTab(browser);
	tabs.setSidebarSegment("queue");
	tabs.setSidebarSegment("prs");
	expect(useReviewModeStore.getState().queueOrigin).toEqual(origin);
	expect(useTabStore.getState().activeWorkspaceId).toBe("queue-review");
	expect(usePaneStore.getState().getFocusedPane("queue-review")?.activeTabId).toBe(browser);
	expect(
		tabs
			.getTabsByWorkspace("queue-review")
			.map((tab) => tab.kind)
			.sort()
	).toEqual(["browser", "pr-review", "review-agent"]);
});
