import { beforeEach, describe, expect, test } from "bun:test";
import type { PRContext } from "../src/shared/github-types";
import { usePaneStore } from "../src/renderer/stores/pane-store";
import { useTabStore } from "../src/renderer/stores/tab-store";

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
	useTabStore.setState({
		activeWorkspaceId: "ws1",
		activeWorkspaceCwd: "/tmp",
		_paneVersion: 0,
	} as never);
}

describe("swapPRReviewFile", () => {
	beforeEach(reset);

	test("falls back to open when no pr-review-file tab exists", () => {
		const id = useTabStore.getState().swapPRReviewFile("ws1", prCtx, "src/a.ts", "typescript");
		const tabs = useTabStore.getState().getTabsByWorkspace("ws1");
		const tab = tabs.find((t) => t.id === id);
		expect(tab?.kind).toBe("pr-review-file");
		if (tab?.kind === "pr-review-file") {
			expect(tab.filePath).toBe("src/a.ts");
		}
	});

	test("mutates existing pr-review-file tab in place when present", () => {
		const id = useTabStore.getState().openPRReviewFile("ws1", prCtx, "src/a.ts", "typescript");
		const swappedId = useTabStore
			.getState()
			.swapPRReviewFile("ws1", prCtx, "src/b.ts", "typescript");
		expect(swappedId).toBe(id);
		const tabs = useTabStore.getState().getTabsByWorkspace("ws1");
		const sameTab = tabs.find((t) => t.id === id);
		if (sameTab?.kind === "pr-review-file") {
			expect(sameTab.filePath).toBe("src/b.ts");
			expect(sameTab.title).toBe("b.ts");
		} else {
			throw new Error("expected pr-review-file tab");
		}
		const prFileTabs = tabs.filter((t) => t.kind === "pr-review-file");
		expect(prFileTabs).toHaveLength(1);
	});
});
