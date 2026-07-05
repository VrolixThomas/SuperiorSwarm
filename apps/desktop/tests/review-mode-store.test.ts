import { beforeEach, describe, expect, test } from "bun:test";
import { useReviewModeStore } from "../src/renderer/stores/review-mode-store";
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
		view: "overview",
		navigatorCollapsed: false,
		drawerOpen: false,
		terminal: null,
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
		expect(useReviewModeStore.getState().terminal).toBeNull();
		expect(useReviewModeStore.getState().commentFilter).toBe("all");
		expect(useReviewModeStore.getState().intent).toBeNull();
	});

	test("open sets active PR and resets view to overview", () => {
		const store = useReviewModeStore.getState();
		store.setView("comments");

		store.open("ws-1", prCtx);

		expect(useReviewModeStore.getState().active).toEqual({ workspaceId: "ws-1", prCtx });
		expect(useReviewModeStore.getState().view).toBe("overview");
	});

	test("open resets drawer, comment filter, and intent", () => {
		const store = useReviewModeStore.getState();
		store.setDrawerOpen(true);
		store.setCommentFilter("pending");
		store.sendIntent("reply", "thread-1");

		store.open("ws-1", prCtx);

		expect(useReviewModeStore.getState().drawerOpen).toBe(false);
		expect(useReviewModeStore.getState().commentFilter).toBe("all");
		expect(useReviewModeStore.getState().intent).toBeNull();
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

	test("open clears stale terminal from prior review workspace", () => {
		const terminal = { tabId: "tab-1", workspaceId: "ws-1", cwd: "/tmp/r" };
		const store = useReviewModeStore.getState();
		store.open("ws-1", prCtx);
		store.setTerminal(terminal);

		store.open("ws-2", { ...prCtx, number: 2, title: "other" });

		expect(useReviewModeStore.getState().terminal).toBeNull();
	});
});
