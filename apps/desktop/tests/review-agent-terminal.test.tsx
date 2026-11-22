import { expect, mock, test } from "bun:test";
import { act } from "react";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "agent workspace session lifecycle")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	let mounts = 0;
	mock.module("../src/renderer/components/Terminal", () => ({
		Terminal: ({ id, cwd }: { id: string; cwd: string }) => {
			mounts++;
			return <div data-live-terminal={id}>{cwd}</div>;
		},
	}));
	const { ReviewAgentTerminal } = await import(
		"../src/renderer/components/review-mode/ReviewAgentTerminal"
	);
	const { useTabStore } = await import("../src/renderer/stores/tab-store");
	const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
	const props = { id: "review-path:run:1", workspaceId: "review", cwd: "/old-path", active: true };
	test("a completed session shows its outcome instead of trying to create a terminal", async () => {
		mounts = 0;
		useReviewModeStore.setState({
			active: {
				workspaceId: "review",
				prCtx: {
					provider: "github",
					owner: "o",
					repo: "r",
					number: 1,
					title: "PR",
					sourceBranch: "feature",
					targetBranch: "main",
					repoPath: "/repo",
				},
			},
			view: "terminal",
		});
		const review = useReviewModeStore.getState().active;
		if (review)
			useTabStore.getState().activateReviewWorkspace(review.workspaceId, "/review", review.prCtx);
		const h = await renderBrowserTest(<ReviewAgentTerminal {...props} />, [], false, {
			request: () => ({
				status: "ended",
				runState: "completed",
				message: "Mapping completed. Results are in the PR review.",
			}),
		});
		try {
			await h.settle();
			expect(h.container.textContent).toContain("Agent finished");
			expect(mounts).toBe(0);
			expect(h.calls.every((call) => call.path === "reviewPath.terminalState")).toBe(true);
			await act(async () => h.container.querySelector("button")?.click());
			expect(useTabStore.getState().getActiveTabId()).toBe("pr-review:review");
		} finally {
			await h.cleanup();
		}
	});
	test("waits for verified live availability and uses its canonical working directory", async () => {
		mounts = 0;
		let finish: ((value: unknown) => void) | undefined;
		const pending = new Promise((resolve) => {
			finish = resolve;
		});
		const h = await renderBrowserTest(<ReviewAgentTerminal {...props} />, [], false, {
			request: () => pending,
		});
		try {
			expect(mounts).toBe(0);
			expect(h.container.textContent).toContain("Checking agent session");
			await act(async () => {
				finish?.({
					status: "available",
					runState: "running",
					cwd: "/verified-checkout",
					message: "Agent running",
				});
			});
			await h.settle();
			expect(h.container.querySelector("[data-live-terminal]")?.textContent).toBe(
				"/verified-checkout"
			);
		} finally {
			await h.cleanup();
		}
	});
	test("unverifiable sessions offer a status check without mounting a PTY", async () => {
		mounts = 0;
		const h = await renderBrowserTest(<ReviewAgentTerminal {...props} />, [], false, {
			request: () => ({ status: "unavailable", message: "Session could not be verified." }),
		});
		try {
			await h.settle();
			expect(h.container.textContent).toContain("Agent session unavailable");
			expect(h.container.textContent).toContain("Check session again");
			expect(mounts).toBe(0);
		} finally {
			await h.cleanup();
		}
	});
}
