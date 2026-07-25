import { beforeEach, describe, expect, test } from "bun:test";
import { shouldShowReviewMode, useReviewModeStore } from "../src/renderer/stores/review-mode-store";
import type { PRContext } from "../src/shared/github-types";

const prCtx: PRContext = {
	provider: "github",
	owner: "o",
	repo: "r",
	number: 1,
	title: "t",
	sourceBranch: "feat",
	targetBranch: "main",
	repoPath: "/tmp/r",
};

function reset() {
	useReviewModeStore.setState({
		active: null,
		lastWorkspaceId: null,
		view: "overview",
		navigatorCollapsed: false,
		drawerOpen: false,
		drawerHeight: 300,
		terminals: {},
		commentFilter: "all",
		intent: null,
	});
}

describe("review-mode-store", () => {
	beforeEach(reset);

	test("starts with review mode defaults", () => {
		expect(useReviewModeStore.getState().active).toBeNull();
		expect(useReviewModeStore.getState().view).toBe("overview");
		expect(useReviewModeStore.getState().navigatorCollapsed).toBe(false);
		expect(useReviewModeStore.getState().drawerOpen).toBe(false);
		expect(useReviewModeStore.getState().drawerHeight).toBe(300);
		expect(useReviewModeStore.getState().terminals).toEqual({});
		expect(useReviewModeStore.getState().commentFilter).toBe("all");
		expect(useReviewModeStore.getState().intent).toBeNull();
	});

	test("Review Mode is visible only in the PR segment for its active workspace", () => {
		const active = { workspaceId: "ws-1", prCtx };

		expect(shouldShowReviewMode("prs", "ws-1", active)).toBe(true);
		expect(shouldShowReviewMode("repos", "ws-1", active)).toBe(false);
		expect(shouldShowReviewMode("tickets", "ws-1", active)).toBe(false);
		expect(shouldShowReviewMode("prs", "ws-2", active)).toBe(false);
		expect(shouldShowReviewMode("prs", null, active)).toBe(false);
	});

	test("open of a different workspace resets view, filter, drawer, intent", () => {
		const store = useReviewModeStore.getState();
		store.open("ws-1", prCtx);
		store.setView("comments");
		store.setCommentFilter("pending");
		store.setDrawerOpen(true);
		store.sendIntent("reply", "thread-1");

		store.open("ws-2", { ...prCtx, number: 2 });

		const s = useReviewModeStore.getState();
		expect(s.active).toEqual({ workspaceId: "ws-2", prCtx: { ...prCtx, number: 2 } });
		expect(s.view).toBe("overview");
		expect(s.commentFilter).toBe("all");
		expect(s.drawerOpen).toBe(false);
		expect(s.intent).toBeNull();
	});

	test("open of the already-active workspace preserves view, filter, drawer", () => {
		const store = useReviewModeStore.getState();
		store.open("ws-1", prCtx);
		store.setView("changes");
		store.setCommentFilter("pending");
		store.setDrawerOpen(true);

		store.open("ws-1", prCtx);

		const s = useReviewModeStore.getState();
		expect(s.view).toBe("changes");
		expect(s.commentFilter).toBe("pending");
		expect(s.drawerOpen).toBe(true);
	});

	test("reopen after close preserves view and filter for the same workspace", () => {
		const store = useReviewModeStore.getState();
		store.open("ws-1", prCtx);
		store.setView("changes");
		store.setCommentFilter("accepted");

		store.close();
		store.open("ws-1", prCtx);

		const s = useReviewModeStore.getState();
		expect(s.view).toBe("changes");
		expect(s.commentFilter).toBe("accepted");
	});

	test("terminals survive open/close/open cycles and workspace switches", () => {
		const store = useReviewModeStore.getState();
		store.open("ws-1", prCtx);
		store.setTerminal({ tabId: "tab-1", workspaceId: "ws-1", cwd: "/tmp/r" });

		store.close();
		store.open("ws-2", { ...prCtx, number: 2 });
		store.setTerminal({ tabId: "tab-2", workspaceId: "ws-2", cwd: "/tmp/r2" });
		store.open("ws-1", prCtx);

		const s = useReviewModeStore.getState();
		expect(s.terminals["ws-1"]).toEqual({ tabId: "tab-1", workspaceId: "ws-1", cwd: "/tmp/r" });
		expect(s.terminals["ws-2"]).toEqual({ tabId: "tab-2", workspaceId: "ws-2", cwd: "/tmp/r2" });
	});

	test("setTerminal replaces the terminal for its own workspace only", () => {
		const store = useReviewModeStore.getState();
		store.setTerminal({ tabId: "tab-1", workspaceId: "ws-1", cwd: "/tmp/r" });
		store.setTerminal({ tabId: "tab-9", workspaceId: "ws-1", cwd: "/tmp/r" });

		expect(useReviewModeStore.getState().terminals["ws-1"]?.tabId).toBe("tab-9");
	});

	test("terminal drawer height is resizable within usable bounds", () => {
		const store = useReviewModeStore.getState();

		store.setDrawerHeight(420);
		expect(useReviewModeStore.getState().drawerHeight).toBe(420);

		store.setDrawerHeight(40);
		expect(useReviewModeStore.getState().drawerHeight).toBe(180);

		store.setDrawerHeight(900);
		expect(useReviewModeStore.getState().drawerHeight).toBe(700);
	});

	test("close clears active PR, drawer, and intent", () => {
		const store = useReviewModeStore.getState();
		store.open("ws-1", prCtx);
		store.setDrawerOpen(true);
		store.sendIntent("edit", "thread-1");

		store.close();

		expect(useReviewModeStore.getState().active).toBeNull();
		expect(useReviewModeStore.getState().drawerOpen).toBe(false);
		expect(useReviewModeStore.getState().intent).toBeNull();
	});

	test("sendIntent bumps nonce for identical intents", () => {
		const store = useReviewModeStore.getState();

		store.sendIntent("reply", "thread-1");
		const first = useReviewModeStore.getState().intent;
		store.sendIntent("reply", "thread-1");
		const second = useReviewModeStore.getState().intent;

		if (!first || !second) {
			throw new Error("Expected sendIntent to set intents");
		}
		expect(first.kind).toBe("reply");
		expect(first.threadId).toBe("thread-1");
		expect(second.kind).toBe("reply");
		expect(second.threadId).toBe("thread-1");
		expect(second.nonce).toBe(first.nonce + 1);
	});

	test("toggleNavigator flips navigatorCollapsed", () => {
		const store = useReviewModeStore.getState();

		store.toggleNavigator();
		expect(useReviewModeStore.getState().navigatorCollapsed).toBe(true);

		useReviewModeStore.getState().toggleNavigator();
		expect(useReviewModeStore.getState().navigatorCollapsed).toBe(false);
	});
});
