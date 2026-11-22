import { expect, mock, test } from "bun:test";
import { act } from "react";
import type { ReviewAgentJob } from "../src/shared/review-agent-job";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
if (inIsolatedFileBrowserTest(import.meta.path, "durable review agent tab UI")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	let terminals = 0;
	mock.module("../src/renderer/components/review-mode/ReviewAgentTerminal", () => ({
		ReviewAgentTerminal: () => {
			terminals++;
			return <div>verified terminal</div>;
		},
	}));
	const { ReviewAgentTab } = await import("../src/renderer/components/review-mode/ReviewAgentTab");
	const { observeReviewAgentJob } = await import("../src/renderer/lib/review-agent-jobs");
	const { useTabStore } = await import("../src/renderer/stores/tab-store");
	const { usePaneStore } = await import("../src/renderer/stores/pane-store");
	const identity = {
		workspaceId: "review-ui",
		provider: "github" as const,
		owner: "o",
		repo: "r",
		prNumber: 1,
		headSha: "a".repeat(40),
	};
	const job: ReviewAgentJob = {
		id: "job-ui",
		identity,
		agent: { id: "codex", label: "Codex" },
		kind: "mapping",
		state: "preparing",
		phase: "fetching",
		fetchProgress: { stage: "receiving", percent: 42, current: 42, total: 100, bytes: 1048576 },
		attempt: 1,
		trigger: "manual",
		alsoReview: true,
		startedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		activity: [
			{
				at: new Date().toISOString(),
				phase: "fetching",
				message: "Fetching the exact PR revision",
			},
		],
	};
	test("preparing has a cancellable view before any terminal, with no launch-on-mount", async () => {
		terminals = 0;
		const h = await renderBrowserTest(
			<ReviewAgentTab
				workspaceId={identity.workspaceId}
				jobId={job.id}
				active
				savedScrollback={{}}
			/>,
			[],
			false,
			{
				request: (path, input) => {
					if (path === "reviewPath.jobs") return [job];
					if (path === "reviewPath.cancelJob") {
						expect(input).toEqual({ workspaceId: identity.workspaceId, jobId: job.id });
						return { ...job, state: "cancelled" };
					}
					return [];
				},
			}
		);
		try {
			expect(h.container.textContent).toContain("Fetching the exact PR revision");
			expect(h.container.querySelector("output")?.textContent).toBe(
				"Receiving objects · 42% · 42 / 100 · 1.0 MiB"
			);
			expect(terminals).toBe(0);
			const button = [...h.container.querySelectorAll("button")].find(
				(b) => b.textContent === "Cancel"
			);
			await act(async () => button?.click());
			await h.settle();
			expect(h.calls.filter((c) => c.path === "reviewPath.cancelJob")).toHaveLength(1);
			expect(h.calls.some((c) => c.path === "reviewPath.startJob")).toBe(false);
		} finally {
			await h.cleanup();
		}
	});
	test("retry retains job identity and original review option without opening a terminal", async () => {
		const failed = { ...job, state: "failed" as const, error: "Revision fetch timed out" };
		const h = await renderBrowserTest(
			<ReviewAgentTab
				workspaceId={identity.workspaceId}
				jobId={job.id}
				active
				savedScrollback={{}}
			/>,
			[],
			false,
			{
				request: (path, input) => {
					if (path === "reviewPath.jobs") return [failed];
					if (path === "reviewPath.startJob") {
						expect(input).toMatchObject({ retryJobId: job.id, identity, alsoReview: true });
						return { ...job, attempt: 2 };
					}
					return [];
				},
			}
		);
		try {
			expect(h.container.textContent).toContain("Revision fetch timed out");
			await act(async () =>
				[...h.container.querySelectorAll("button")].find((b) => b.textContent === "Retry")?.click()
			);
			await h.settle();
			expect(h.calls.filter((c) => c.path === "reviewPath.startJob")).toHaveLength(1);
		} finally {
			await h.cleanup();
		}
	});
	test("observing an accepted job does not change focus and closing its view survives polling", () => {
		const store = useTabStore.getState();
		store.activateReviewWorkspace(identity.workspaceId, "/repo", {
			provider: "github",
			owner: "o",
			repo: "r",
			number: 1,
			title: "PR",
			repoPath: "/repo",
			sourceBranch: "feature",
			targetBranch: "main",
		});
		const before = useTabStore.getState().getActiveTabId();
		observeReviewAgentJob({ ...job, id: "hidden-job" }, true);
		expect(useTabStore.getState().getActiveTabId()).toBe(before);
		const pane = usePaneStore.getState().getFocusedPane(identity.workspaceId);
		if (!pane) throw new Error("Review pane missing");
		usePaneStore
			.getState()
			.removeTabFromPane(identity.workspaceId, pane.id, "review-agent:hidden-job");
		observeReviewAgentJob({ ...job, id: "hidden-job", state: "running" });
		expect(
			useTabStore
				.getState()
				.getTabsByWorkspace(identity.workspaceId)
				.some((t) => t.id === "review-agent:hidden-job")
		).toBe(false);
	});
}
