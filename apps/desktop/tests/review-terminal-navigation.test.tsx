import { expect, mock, test } from "bun:test";
import { act } from "react";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "review agent workspace navigation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	mock.module("../src/renderer/components/review-mode/ReviewModeShell", () => ({
		ReviewModeShell: () => <div>PR reading view</div>,
	}));
	mock.module("../src/renderer/components/panes/LayoutRenderer", () => ({
		LayoutRenderer: () => <div>Workspace tabs</div>,
	}));
	const { MainContentArea } = await import("../src/renderer/components/MainContentArea");
	const { openReviewTerminalTab } = await import("../src/renderer/lib/review-terminal-tab");
	const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
	const { useTabStore } = await import("../src/renderer/stores/tab-store");
	test("agent tab displays the workspace and Back returns to PR without removing the terminal", async () => {
		const prCtx = {
			provider: "github" as const,
			owner: "team",
			repo: "repo",
			number: 42,
			title: "Review this",
			sourceBranch: "feature",
			targetBranch: "main",
			repoPath: "/review",
		};
		useTabStore.getState().activateReviewWorkspace("review-ws", "/review", prCtx);
		const terminal = { workspaceId: "review-ws", tabId: "review-path:run:1", cwd: "/review" };
		useReviewModeStore.getState().setTerminal(terminal);
		openReviewTerminalTab(terminal);
		const h = await renderBrowserTest(<MainContentArea savedScrollback={{}} />, [], false, {
			request: () => null,
		});
		try {
			await h.settle();
			expect(h.container.textContent).toContain("Workspace tabs");
			expect(h.container.querySelector('[aria-label="PR agent workspace"]')).not.toBeNull();
			expect(h.container.textContent).toContain("team/repo · PR #42");
			expect(h.container.textContent).toContain("All PRs");
			expect(h.container.textContent).not.toContain("Select a pull request");
			await act(async () =>
				Array.from(h.container.querySelectorAll("button"))
					.find((button) => button.textContent?.includes("Back to PR review"))
					?.click()
			);
			expect(h.container.textContent).toContain("PR reading view");
			expect(
				useTabStore
					.getState()
					.getTabsByWorkspace("review-ws")
					.filter((tab) => tab.id === terminal.tabId)
			).toHaveLength(1);
			await act(async () => {
				openReviewTerminalTab(terminal);
			});
			await act(async () =>
				Array.from(h.container.querySelectorAll("button"))
					.find((button) => button.textContent?.includes("All PRs"))
					?.click()
			);
			expect(useReviewModeStore.getState().queueOpen).toBe(true);
			expect(h.container.textContent).toContain("PR reading view");
		} finally {
			await h.cleanup();
		}
	});
}
