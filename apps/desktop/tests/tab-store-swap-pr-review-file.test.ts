import { beforeEach, describe, expect, test } from "bun:test";
import { usePaneStore } from "../src/renderer/stores/pane-store";
import {
	prReviewSessionKey,
	usePRReviewSessionStore,
} from "../src/renderer/stores/pr-review-session-store";
import { useReviewModeStore } from "../src/renderer/stores/review-mode-store";
import { useTabStore } from "../src/renderer/stores/tab-store";
import type { PRContext } from "../src/shared/github-types";
import { formatPrIdentifier } from "../src/shared/pr-identifier";

const prCtx: PRContext = {
	provider: "github",
	owner: "acme",
	repo: "app",
	number: 7,
	title: "Test PR",
	sourceBranch: "feature/x",
	targetBranch: "main",
	repoPath: "/tmp/repo",
};

function reset() {
	usePaneStore.setState({ panesByWorkspace: new Map(), focusedPaneId: null });
	usePRReviewSessionStore.setState({ sessions: new Map() });
	useReviewModeStore.setState({
		active: null,
		view: "overview",
		navigatorCollapsed: false,
		drawerOpen: false,
		terminal: null,
		commentFilter: "all",
		intent: null,
	});
	useTabStore.setState({
		activeWorkspaceId: "ws1",
		activeWorkspaceCwd: "/tmp",
		_paneVersion: 0,
	} as never);
}

describe("swapPRReviewFile", () => {
	beforeEach(reset);

	test("opens Review Mode changes view when no legacy pr-review-file tab exists", () => {
		const id = useTabStore.getState().swapPRReviewFile("ws1", prCtx, "src/a.ts", "typescript");
		const sessionKey = prReviewSessionKey("ws1", formatPrIdentifier(prCtx));
		const reviewMode = useReviewModeStore.getState();

		expect(id).toBe("review-mode");
		expect(reviewMode.active).toEqual({ workspaceId: "ws1", prCtx });
		expect(reviewMode.view).toBe("changes");
		expect(usePRReviewSessionStore.getState().sessions.get(sessionKey)?.activeFilePath).toBe(
			"src/a.ts"
		);
		expect(useTabStore.getState().getTabsByWorkspace("ws1")).toHaveLength(0);
	});

	test("legacy openPRReviewFile and swapPRReviewFile keep using one Review Mode surface", () => {
		const id = useTabStore.getState().openPRReviewFile("ws1", prCtx, "src/a.ts", "typescript");
		const swappedId = useTabStore
			.getState()
			.swapPRReviewFile("ws1", prCtx, "src/b.ts", "typescript");
		expect(swappedId).toBe(id);
		const sessionKey = prReviewSessionKey("ws1", formatPrIdentifier(prCtx));

		expect(id).toBe("review-mode");
		expect(useReviewModeStore.getState().active).toEqual({ workspaceId: "ws1", prCtx });
		expect(useReviewModeStore.getState().view).toBe("changes");
		expect(usePRReviewSessionStore.getState().sessions.get(sessionKey)?.activeFilePath).toBe(
			"src/b.ts"
		);
		expect(useTabStore.getState().getTabsByWorkspace("ws1")).toHaveLength(0);
	});
});
