import { beforeEach, describe, expect, test } from "bun:test";
import { usePaneStore } from "../src/renderer/stores/pane-store";
import { useReviewModeStore } from "../src/renderer/stores/review-mode-store";
import { useTabStore } from "../src/renderer/stores/tab-store";

beforeEach(() => {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	useTabStore.setState({
		activeWorkspaceId: null,
		activeWorkspaceCwd: "",
		sidebarSegment: "repos",
		workspaceMetadata: {},
		terminalCreateIntents: {},
		activeWorkspaceBySegment: { queue: null, repos: null, tickets: null, prs: null, hermes: null },
		workspaceBackStack: [],
		workspaceForwardStack: [],
		pendingWorkspaceHistoryEntry: null,
		selectedHermesSession: null,
	});
	useReviewModeStore.setState({ active: null, terminals: {}, drawerOpen: false, view: "overview" });
});

describe("direct Queue navigation", () => {
	for (const segment of ["repos", "tickets", "prs", "hermes"] as const) {
		test(`leaves ${segment} directly without an intermediate restoration or shell`, () => {
			const store = useTabStore.getState();
			store.setActiveWorkspace("current", "/current");
			useTabStore.setState({
				sidebarSegment: segment,
				activeWorkspaceBySegment: {
					queue: null,
					repos: { id: "unrelated", cwd: "/unrelated" },
					tickets: null,
					prs: null,
					hermes: null,
				},
			});
			store.navigateToWorkspace("target", "/target");
			const state = useTabStore.getState();
			expect(state.sidebarSegment).toBe("repos");
			expect(state.activeWorkspaceId).toBe("target");
			expect(
				state.workspaceBackStack.map((x) => (x.kind === "workspace" ? x.id : x.sessionId))
			).toEqual(["current"]);
			expect(state.getTabsByWorkspace("target")).toHaveLength(0);
		});
	}
	test("Back returns to the selected Hermes conversation", () => {
		const store = useTabStore.getState();
		const selection = { connectionId: "connection", profileId: "profile", sessionId: "session" };
		store.selectHermesSession(selection);
		store.navigateToWorkspace("target", "/target");
		expect(useTabStore.getState().workspaceBackStack).toEqual([
			{ kind: "hermes-session", ...selection, pane: "chat" },
		]);
		store.goBackWorkspace();
		expect(useTabStore.getState().sidebarSegment).toBe("hermes");
		expect(useTabStore.getState().selectedHermesSession).toEqual(selection);
	});
	test("PR activation retains direct history from Hermes", () => {
		const store = useTabStore.getState();
		store.selectHermesSession({ connectionId: "c", sessionId: "s" });
		store.activateReviewWorkspace("review", "/review", {
			provider: "github",
			owner: "o",
			repo: "r",
			number: 1,
			title: "PR",
			sourceBranch: "feature",
			targetBranch: "main",
			repoPath: "/repo",
		});
		expect(useTabStore.getState().sidebarSegment).toBe("prs");
		expect(useTabStore.getState().workspaceBackStack[0]?.kind).toBe("hermes-session");
		expect(useReviewModeStore.getState().active?.workspaceId).toBe("review");
	});
});

// These fixtures expose only navigation endpoints: no acknowledge, launch, attach or markCommitSeen.
import { mock } from "bun:test";
import {
	type QueueNavigationApi,
	openQueueTarget,
} from "../src/renderer/lib/activity-queue-navigation";
import type { ActivityQueueTarget } from "../src/shared/activity-queue";

function apiFixture(type = "worktree") {
	const workspace = {
		id: "target",
		projectId: "project",
		type,
		name: "Target",
		path: "/target",
		worktreePath: "/target",
		prProvider: type === "review" ? "github" : null,
		prIdentifier: type === "review" ? "owner/repo#7" : null,
	};
	const project = {
		id: "project",
		repoPath: "/repo",
		remoteOwner: "owner",
		remoteRepo: "repo",
		remoteHost: "github.com",
	};
	const review = mock(async () => ({ id: "review", worktreePath: "/review" }));
	const sessions = mock(async () => [
		{
			terminalId: "terminal-2",
			workspaceId: "target",
			provider: "codex",
			providerSessionId: "session-2",
			state: "idle",
		},
	]);
	const api = {
		crossRepoOrchestrators: {
			get: {
				query: mock(async () => ({ id: "target", workDir: "/coordinator", name: "Coordinator" })),
			},
		},
		workspaces: {
			getById: { query: mock(async () => workspace) },
			listByProject: { query: mock(async () => ({ orchestrators: [], loose: [workspace] })) },
			getOrCreateReview: { mutate: review },
		},
		projects: {
			getById: { query: mock(async () => project) },
			getByRepo: { query: mock(async () => [project]) },
			getPRDetails: {
				query: mock(async () => ({ title: "PR", sourceBranch: "feature", targetBranch: "main" })),
			},
		},
		agentSessions: { list: { query: sessions } },
		daemon: {
			listSessions: mock(async () => ({
				daemonSessions: [
					{ id: "terminal-1", cwd: "/target", pid: 1 },
					{ id: "terminal-2", cwd: "/target", pid: 2 },
				],
				liveSessions: [],
				callbackIds: [],
			})),
		},
	};
	return { api: api as unknown as QueueNavigationApi, raw: api, review, sessions, workspace };
}
const terminalTarget: ActivityQueueTarget = {
	type: "terminal",
	workspaceId: "target",
	terminalId: "terminal-2",
	provider: "codex",
	providerSessionId: "session-2",
};
const prTarget: ActivityQueueTarget = {
	type: "pr",
	provider: "github",
	owner: "owner",
	repo: "repo",
	number: 7,
	title: "PR",
	sourceBranch: "feature",
	targetBranch: "main",
	projectId: "project",
};

describe("Queue source targeting", () => {
	test("workspace reporter target opens the exact reporting chat instead of the selected sibling", async () => {
		const store = useTabStore.getState();
		store.setActiveWorkspace("target", "/target");
		store.addTerminalTab("target", "/target", "Reporting conversation", "terminal-2");
		store.addTerminalTab("target", "/target", "Unrelated sibling", "terminal-1");
		store.setActiveTab("terminal-1");
		store.setActiveWorkspace("previous", "/previous");
		const { api } = apiFixture();
		// Validated reports now project this exact target (backend projection is tested separately).
		const destination = await openQueueTarget(terminalTarget, api);
		expect(destination).toEqual({ workspaceId: "target", terminalId: "terminal-2" });
		expect(usePaneStore.getState().getFocusedPane("target")?.activeTabId).toBe("terminal-2");
	});

	test("selects the exact tab and split pane, preserving the other terminal", async () => {
		const store = useTabStore.getState();
		store.setActiveWorkspace("target", "/target");
		store.addTerminalTab("target", "/target", "First", "terminal-1");
		const pane = usePaneStore.getState().getFocusedPane("target");
		if (!pane) throw new Error("Missing target pane");
		usePaneStore.getState().splitPane("target", pane.id, "horizontal", {
			kind: "terminal",
			id: "terminal-2",
			workspaceId: "target",
			cwd: "/target",
			title: "Second",
		});
		store.setActiveWorkspace("previous", "/previous");
		const { api } = apiFixture();
		const destination = await openQueueTarget(terminalTarget, api);
		expect(destination).toEqual({ workspaceId: "target", terminalId: "terminal-2" });
		expect(useTabStore.getState().terminalCreateIntents).toEqual({
			"terminal-1": "attach-existing-only",
			"terminal-2": "attach-existing-only",
		});
		store.addTerminalTab("target", "/target", "Explicit new shell", "new-terminal");
		expect(useTabStore.getState().terminalCreateIntents["new-terminal"]).toBeUndefined();
		store.removeTab("new-terminal");
		// Explicit ordinary navigation restores the usual creation behavior.
		store.navigateToWorkspace("target", "/target");
		expect(useTabStore.getState().terminalCreateIntents).toEqual({});
		expect(usePaneStore.getState().getFocusedPane("target")?.activeTabId).toBe("terminal-2");
		expect(
			store
				.getTabsByWorkspace("target")
				.map((t) => t.id)
				.sort()
		).toEqual(["terminal-1", "terminal-2"]);
	});
	test("reopens the exact review drawer without creating a pane terminal", async () => {
		const { api } = apiFixture("review");
		useReviewModeStore
			.getState()
			.setTerminal({ workspaceId: "target", tabId: "terminal-2", cwd: "/target" });
		await openQueueTarget(terminalTarget, api);
		expect(useTabStore.getState().sidebarSegment).toBe("prs");
		expect(useReviewModeStore.getState().active?.workspaceId).toBe("target");
		expect(useReviewModeStore.getState().drawerOpen).toBe(true);
		expect(useTabStore.getState().terminalCreateIntents["terminal-2"]).toBe("attach-existing-only");
		expect(useTabStore.getState().getTabsByWorkspace("target")).toHaveLength(0);
	});
	test("missing terminal and changed provider session preserve active work", async () => {
		const { api } = apiFixture();
		useTabStore.getState().setActiveWorkspace("current", "/current");
		await expect(openQueueTarget(terminalTarget, api)).rejects.toThrow("no longer open");
		await expect(
			openQueueTarget({ ...terminalTarget, providerSessionId: "old-session" }, api)
		).rejects.toThrow("no longer matches");
		expect(useTabStore.getState().activeWorkspaceId).toBe("current");
		expect(useTabStore.getState().getTabsByWorkspace("target")).toHaveLength(0);
	});
	test("PR duplicate clicks reuse one in-flight review operation", async () => {
		const { api, raw, review } = apiFixture();
		let resolve!: () => void;
		const pending = new Promise<void>((r) => {
			resolve = r;
		});
		review.mockImplementation(async () => {
			await pending;
			return { id: "review", worktreePath: "/review" };
		});
		const one = openQueueTarget(prTarget, api);
		const two = openQueueTarget(prTarget, api);
		resolve();
		expect(await one).toEqual(await two);
		expect(review).toHaveBeenCalledTimes(1);
		expect(raw.projects.getByRepo.query).toHaveBeenCalledTimes(1);
		expect(review).toHaveBeenCalledWith(
			expect.objectContaining({ prProvider: "github", prIdentifier: "owner/repo#7" })
		);
		expect(useReviewModeStore.getState().active?.prCtx.repoPath).toBe("/review");
		expect(useTabStore.getState().getTabsByWorkspace("review")).toHaveLength(0);
	});
	test("PR failure leaves current workspace and unlocks retry", async () => {
		const { api, review } = apiFixture();
		useTabStore.getState().setActiveWorkspace("current", "/current");
		review.mockImplementationOnce(async () => {
			throw new Error("Fetch failed");
		});
		await expect(openQueueTarget(prTarget, api)).rejects.toThrow("Fetch failed");
		expect(useTabStore.getState().activeWorkspaceId).toBe("current");
		await openQueueTarget(prTarget, api);
		expect(review).toHaveBeenCalledTimes(2);
	});
	test("same repository name on a different provider is not navigated", async () => {
		const { api, review } = apiFixture();
		await expect(openQueueTarget({ ...prTarget, provider: "bitbucket" }, api)).rejects.toThrow(
			"not available"
		);
		expect(review).not.toHaveBeenCalled();
	});
	test("unavailable and Hermes recovery targets explain their limits", async () => {
		const { api } = apiFixture();
		await expect(
			openQueueTarget({ type: "unavailable", reason: "Deleted workspace" }, api)
		).rejects.toThrow("Deleted workspace");
		await expect(
			openQueueTarget({ type: "hermes", profileId: "p", sessionId: "s" }, api)
		).rejects.toThrow("cannot be located safely yet");
	});
});

test("missing PR branches are resolved before creating a review workspace", async () => {
	const { api, raw, review } = apiFixture();
	await openQueueTarget({ ...prTarget, sourceBranch: "", targetBranch: "" }, api);
	expect(raw.projects.getPRDetails.query).toHaveBeenCalledWith({
		provider: "github",
		owner: "owner",
		repo: "repo",
		number: 7,
	});
	expect(review).toHaveBeenCalledWith(
		expect.objectContaining({ sourceBranch: "feature", targetBranch: "main" })
	);
});

test("missing live PTYs cannot be recreated by Queue navigation", async () => {
	const { api, raw } = apiFixture();
	const store = useTabStore.getState();
	store.addTerminalTab("target", "/target", "Stored", "terminal-2");
	store.setActiveWorkspace("current", "/current");
	raw.daemon.listSessions.mockResolvedValue({
		daemonSessions: [],
		liveSessions: [],
		callbackIds: [],
	});
	await expect(openQueueTarget(terminalTarget, api)).rejects.toThrow("no longer running");
	expect(useTabStore.getState().activeWorkspaceId).toBe("current");
	await expect(openQueueTarget({ type: "workspace", workspaceId: "target" }, api)).rejects.toThrow(
		"no longer running"
	);
	expect(useTabStore.getState().activeWorkspaceId).toBe("current");
});

test("terminal service errors retain the current workspace", async () => {
	const { api, raw } = apiFixture();
	const store = useTabStore.getState();
	store.addTerminalTab("target", "/target", "Stored", "terminal-2");
	store.setActiveWorkspace("current", "/current");
	raw.daemon.listSessions.mockRejectedValue(new Error("Disconnected"));
	await expect(openQueueTarget(terminalTarget, api)).rejects.toThrow("could not be verified");
	expect(useTabStore.getState().activeWorkspaceId).toBe("current");
});

test("closing the requested chat during inventory preflight cannot select its sibling", async () => {
	const { api, raw } = apiFixture();
	const store = useTabStore.getState();
	store.addTerminalTab("target", "/target", "Sibling", "terminal-1");
	store.addTerminalTab("target", "/target", "Reporter", "terminal-2");
	store.setActiveWorkspace("current", "/current");
	raw.daemon.listSessions.mockImplementationOnce(async () => {
		const pane = usePaneStore.getState().findPaneForTab("target", "terminal-2");
		if (pane) usePaneStore.getState().removeTabFromPane("target", pane.id, "terminal-2");
		return {
			daemonSessions: [
				{ id: "terminal-1", cwd: "/target", pid: 1 },
				{ id: "terminal-2", cwd: "/target", pid: 2 },
			],
			liveSessions: [],
			callbackIds: [],
		};
	});
	await expect(openQueueTarget(terminalTarget, api)).rejects.toThrow("no longer open");
	expect(useTabStore.getState().activeWorkspaceId).toBe("current");
	expect(store.getTabsByWorkspace("target").map((tab) => tab.id)).toEqual(["terminal-1"]);
});

test("Queue marks terminals added during preflight before any destination activation", async () => {
	const store = useTabStore.getState();
	store.setActiveWorkspace("target", "/target");
	store.addTerminalTab("target", "/target", "First", "terminal-1");
	store.setActiveWorkspace("previous", "/previous");
	const { api, raw } = apiFixture();
	raw.daemon.listSessions.mockImplementationOnce(async () => {
		store.addTerminalTab("target", "/target", "Restored while awaiting inventory", "terminal-2");
		return {
			daemonSessions: [{ id: "terminal-1", cwd: "/target", pid: 1 }],
			liveSessions: [],
			callbackIds: [],
		};
	});
	const observations: boolean[] = [];
	const unsubscribe = useTabStore.subscribe((state) => {
		if (state.activeWorkspaceId === "target")
			observations.push(
				state.terminalCreateIntents["terminal-1"] === "attach-existing-only" &&
					state.terminalCreateIntents["terminal-2"] === "attach-existing-only"
			);
	});
	try {
		await openQueueTarget({ type: "workspace", workspaceId: "target" }, api);
		expect(observations.length).toBeGreaterThan(0);
		expect(observations.every(Boolean)).toBe(true);
	} finally {
		unsubscribe();
	}
});

for (const exact of [false, true]) {
	test(`coordinator ${exact ? "chat" : "entity"} navigation never substitutes a linked workspace or creates a shell`, async () => {
		const { api, raw } = apiFixture();
		const store = useTabStore.getState();
		store.addTerminalTab("target", "/coordinator", "Coordinator chat", "terminal-2");
		store.setActiveWorkspace("current", "/current");
		const target: ActivityQueueTarget = exact
			? { ...terminalTarget, entity: { kind: "coordinator", id: "target" } }
			: { type: "coordinator", coordinatorId: "target" };
		await openQueueTarget(target, api);
		expect(raw.workspaces.getById.query).not.toHaveBeenCalled();
		expect(raw.crossRepoOrchestrators.get.query).toHaveBeenCalledWith({ id: "target" });
		expect(useTabStore.getState().activeWorkspaceId).toBe("target");
		expect(useTabStore.getState().activeWorkspaceCwd).toBe("/coordinator");
		expect(useTabStore.getState().terminalCreateIntents["terminal-2"]).toBe("attach-existing-only");
		expect(store.getTabsByWorkspace("target").map((t) => t.id)).toEqual(["terminal-2"]);
	});
}
test("mismatched coordinator owner is rejected before navigation", async () => {
	const { api } = apiFixture();
	await expect(
		openQueueTarget({ ...terminalTarget, entity: { kind: "coordinator", id: "other" } }, api)
	).rejects.toThrow("owner does not match");
	expect(useTabStore.getState().activeWorkspaceId).toBeNull();
});
