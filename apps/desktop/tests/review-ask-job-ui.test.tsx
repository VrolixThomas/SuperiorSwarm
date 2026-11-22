import { expect, test } from "bun:test";
import { act } from "react";
import type { ReviewAgentJob } from "../src/shared/review-agent-job";
import type { ReviewPathSnapshot } from "../src/shared/review-path-runtime";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
if (inIsolatedFileBrowserTest(import.meta.path, "Ask durable attempt projection")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { useAskAgent } = await import("../src/renderer/components/review-mode/panel/useAskAgent");
	const identity = {
		workspaceId: "ask-attempt-ui",
		provider: "github" as const,
		owner: "o",
		repo: "r",
		prNumber: 1,
		headSha: "a".repeat(40),
	};
	const pr = {
		provider: "github" as const,
		owner: "o",
		repo: "r",
		number: 1,
		title: "PR",
		sourceBranch: "f",
		targetBranch: "m",
		repoPath: "/repo",
	};
	const retryId = "question-job:2";
	const job: ReviewAgentJob = {
		id: "question-job",
		identity,
		agent: { id: "codex", label: "Codex" },
		kind: "question",
		state: "preparing",
		phase: "metadata",
		attempt: 2,
		trigger: "manual",
		startedAt: null,
		updatedAt: null,
		activity: [],
		question: { id: "original-question", text: "Why?" },
	};
	const snapshot: ReviewPathSnapshot = {
		identity,
		path: null,
		pathVersion: 1,
		conversationId: "c",
		runs: [],
		questions: [],
		messages: [],
	};
	function Harness() {
		const ask = useAskAgent(pr, { identity });
		return (
			<>
				<output data-status>{ask.status}</output>
				<output data-error>{ask.error}</output>
				<output data-messages>{ask.messages.map((m) => m.id).join(",")}</output>
				<output data-questions>
					{ask.questions
						.filter((q) => q.state === "pending")
						.map((q) => q.id)
						.join(",")}
				</output>
				<button type="button" onClick={() => ask.cancel(retryId)}>
					Cancel
				</button>
			</>
		);
	}
	test("retry has one correlated question through preparation and launch; cancellation addresses its job", async () => {
		let current = { ...job };
		const h = await renderBrowserTest(<Harness />, [], false, {
			request: (path, input) => {
				if (path === "reviewPath.get") return snapshot;
				if (path === "reviewPath.jobs") return [current];
				if (path === "reviewPath.cancelJob") {
					expect(input).toEqual({ workspaceId: identity.workspaceId, jobId: job.id });
					current = { ...current, state: "cancelled" };
					return current;
				}
				return [];
			},
		});
		try {
			expect(h.container.querySelector("[data-status]")?.textContent).toBe("pending");
			expect(h.container.querySelector("[data-messages]")?.textContent).toBe(retryId);
			const message = { id: retryId, role: "user" as const, text: "Why?", createdAt: "" };
			snapshot.runs = [
				{
					id: "retry-run",
					identity,
					version: 2,
					kind: "question",
					state: "running",
					conversationId: "c",
					questionId: retryId,
				},
			];
			snapshot.questions = [
				{ id: retryId, runId: "retry-run", conversationId: "c", state: "pending", message },
			];
			snapshot.messages = [message];
			current = { ...current, state: "running", phase: "answering", runId: "retry-run" };
			await act(async () => {
				await h.queryClient.invalidateQueries();
			});
			// The shared durable snapshot controller polls independently of query cache.
			const { useLiveReviewPath } = await import("../src/renderer/lib/review-path-source");
			function Refresh() {
				const live = useLiveReviewPath(identity);
				return (
					<button type="button" onClick={() => void live.controller?.refresh()}>
						Refresh
					</button>
				);
			}
			await h.rerender(
				<>
					<Harness />
					<Refresh />
				</>
			);
			await act(async () =>
				[...h.container.querySelectorAll("button")]
					.find((b) => b.textContent === "Refresh")
					?.click()
			);
			await h.settle();
			expect(h.container.querySelector("[data-messages]")?.textContent).toBe(retryId);
			expect(h.container.querySelector("[data-questions]")?.textContent).toBe(retryId);
			await act(async () =>
				[...h.container.querySelectorAll("button")].find((b) => b.textContent === "Cancel")?.click()
			);
			await h.settle();
			expect(h.calls.filter((c) => c.path === "reviewPath.cancelJob")).toHaveLength(1);
		} finally {
			await h.cleanup();
		}
	});
}
