import { expect, test } from "bun:test";
import { attachReadingPathTerminal } from "../src/renderer/lib/review-connected-terminal";
import { useReviewModeStore } from "../src/renderer/stores/review-mode-store";
import { useTabStore } from "../src/renderer/stores/tab-store";

test("attach an already-running reading terminal without launching or taking focus", async () => {
	useReviewModeStore.setState({ terminals: {}, drawerOpen: false });
	const calls: string[] = [];
	expect(
		await attachReadingPathTerminal(
			"review-ws",
			{
				terminalId: "review-path:run:1",
				reviewWorkspaceId: "review-ws",
				worktreePath: "/review",
				launchScript: "/must-not-run.sh",
			},
			async (input) => {
				calls.push(input.terminalId);
			}
		)
	).toBe(true);
	expect(calls).toEqual(["review-path:run:1"]);
	expect(useReviewModeStore.getState().terminals["review-ws"]?.tabId).toBe("review-path:run:1");
	expect(useReviewModeStore.getState().drawerOpen).toBe(false);
});

test("a lazy agent launch updates the active workspace cwd without opening its terminal", async () => {
	const prCtx = {
		provider: "github" as const,
		owner: "o",
		repo: "r",
		number: 1,
		title: "PR",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath: "/project",
	};
	useTabStore.getState().activateReviewWorkspace("lazy-review", "/project", prCtx);
	useReviewModeStore.setState({ view: "changes", drawerOpen: false });
	await attachReadingPathTerminal(
		"lazy-review",
		{
			terminalId: "review-path:lazy:1",
			reviewWorkspaceId: "lazy-review",
			worktreePath: "/isolated",
		},
		async () => {}
	);
	expect(useTabStore.getState().activeWorkspaceCwd).toBe("/isolated");
	expect(useReviewModeStore.getState().active?.prCtx.repoPath).toBe("/isolated");
	expect(useReviewModeStore.getState().view).toBe("changes");
	expect(useReviewModeStore.getState().drawerOpen).toBe(false);
	expect(useTabStore.getState().getTabsByWorkspace("lazy-review")).toEqual([]);
});

test("reject descriptors from another workspace and do not register failed attachments", async () => {
	useReviewModeStore.setState({ terminals: {} });
	let called = false;
	expect(
		await attachReadingPathTerminal(
			"current",
			{ terminalId: "review-path:run:1", reviewWorkspaceId: "other", worktreePath: "/other" },
			async () => {
				called = true;
			}
		)
	).toBe(false);
	expect(called).toBe(false);
	await expect(
		attachReadingPathTerminal(
			"current",
			{ terminalId: "review-path:run:1", reviewWorkspaceId: "current", worktreePath: "/current" },
			async () => {
				throw Error("Attach failed");
			}
		)
	).rejects.toThrow("Attach failed");
	expect(useReviewModeStore.getState().terminals["current"]).toBeUndefined();
});

test("a terminal attachment completing after the selected head changed cannot replace current UI state", async () => {
	useReviewModeStore.setState({ terminals: {} });
	let current = true;
	let finish: (() => void) | undefined;
	const waiting = attachReadingPathTerminal(
		"review-ws",
		{ terminalId: "review-path:old:1", reviewWorkspaceId: "review-ws", worktreePath: "/review" },
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		() => current
	);
	current = false;
	finish?.();
	expect(await waiting).toBe(false);
	expect(useReviewModeStore.getState().terminals["review-ws"]).toBeUndefined();
});
