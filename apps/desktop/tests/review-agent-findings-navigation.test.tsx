import { expect, mock, test } from "bun:test";
import { type ReactNode, act } from "react";
import type { GitHubPRDetails, PRContext, UnifiedThread } from "../src/shared/github-types";
import type { ReviewAgentJob } from "../src/shared/review-agent-job";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
if (
	inIsolatedFileBrowserTest(
		import.meta.path,
		"agent finding navigation through real Review content"
	)
) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	mock.module("../src/renderer/components/review-mode/step/StepDiff", () => ({
		StepDiff: ({
			filePath,
			threads,
			renderThread,
		}: {
			filePath: string;
			threads: UnifiedThread[];
			renderThread: (thread: UnifiedThread) => ReactNode;
		}) => (
			<div data-diff={filePath}>
				{threads
					.filter((t) => t.path === filePath)
					.map((t) => (
						<div key={t.id}>{renderThread(t)}</div>
					))}
			</div>
		),
	}));
	mock.module("../src/renderer/components/review-mode/step/ContextFileView", () => ({
		ContextFileView: () => null,
	}));
	const { ReviewWorkspace } = await import(
		"../src/renderer/components/review-mode/ReviewWorkspace"
	);
	const { ReviewAgentTab } = await import("../src/renderer/components/review-mode/ReviewAgentTab");
	const { useTabStore } = await import("../src/renderer/stores/tab-store");
	const { usePaneStore } = await import("../src/renderer/stores/pane-store");
	const { usePRReviewSessionStore, prReviewSessionKey } = await import(
		"../src/renderer/stores/pr-review-session-store"
	);
	const { reviewUIStoreFor, reviewUIScopeKey } = await import(
		"../src/renderer/components/review-mode/ReviewUIContext"
	);
	const head = "a".repeat(40);
	const prCtx: PRContext = {
		provider: "github",
		owner: "org",
		repo: "repo",
		number: 10,
		title: "PR",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath: "/repo",
	};
	const details: GitHubPRDetails = {
		title: "PR",
		body: "Description",
		state: "OPEN",
		isDraft: false,
		author: "author",
		authorAvatarUrl: "",
		reviewDecision: null,
		ciState: null,
		checks: [],
		reviewers: [],
		reviewThreads: [],
		conversationComments: [],
		files: [
			{ path: "first.ts", additions: 1, deletions: 0, changeType: "MODIFIED" },
			{ path: "finding.ts", additions: 1, deletions: 0, changeType: "MODIFIED" },
		],
		sourceBranch: "feature",
		targetBranch: "main",
		headCommitOid: head,
	};
	test.each(["finding", "empty", "older", "loading", "fresh", "error", "missing"])(
		"Review findings opens the intended result: %s",
		async (scenario) => {
			const workspaceId = `findings-${scenario}`;
			const active = { workspaceId, prCtx };
			const job: ReviewAgentJob = {
				id: `job-${scenario}`,
				identity: {
					workspaceId,
					provider: "github",
					owner: "org",
					repo: "repo",
					prNumber: 10,
					headSha: scenario === "older" ? "b".repeat(40) : head,
				},
				agent: { id: "codex", label: "Codex" },
				kind: "mapping",
				state: "completed",
				phase: "completed",
				attempt: 1,
				trigger: "manual",
				startedAt: null,
				updatedAt: null,
				activity: [],
			};
			const draft = {
				id: `draft-${scenario}`,
				commitSha: head,
				prProvider: "github",
				prIdentifier: "org/repo#10",
				status: "ready",
				createdAt: new Date().toISOString(),
				comments:
					scenario === "empty"
						? []
						: [
								{
									id: "finding-comment",
									filePath: "finding.ts",
									lineNumber: 3,
									side: "RIGHT",
									body: "Agent finding body",
									status: "pending",
									userEdit: null,
									createdAt: new Date(),
									source: "ai",
								},
							],
			};
			usePaneStore.setState({ layouts: {}, focusedPaneId: null });
			usePRReviewSessionStore.setState({ sessions: new Map() });
			const store = useTabStore.getState();
			store.activateReviewWorkspace(workspaceId, "/repo", prCtx);
			store.ensureReviewAgentTab(job);
			store.revealReviewAgentTab(workspaceId, { jobId: job.id });
			const ui = reviewUIStoreFor(reviewUIScopeKey(active));
			ui.getState().setOverviewOpen(true);
			function Harness() {
				const selected = useTabStore((s) => s.getActiveTabId());
				return (
					<>
						<div style={{ display: selected === `pr-review:${workspaceId}` ? "block" : "none" }}>
							<ReviewWorkspace
								active={active}
								tabMode
								isActive={selected === `pr-review:${workspaceId}`}
							/>
						</div>
						<div style={{ display: selected === `review-agent:${job.id}` ? "block" : "none" }}>
							<ReviewAgentTab
								workspaceId={workspaceId}
								jobId={job.id}
								active={selected === `review-agent:${job.id}`}
								savedScrollback={{}}
							/>
						</div>
					</>
				);
			}
			let release: (() => void) | undefined;
			const pending = new Promise<void>((resolve) => {
				release = resolve;
			});
			let draftReads = 0;
			const h = await renderBrowserTest(<Harness />, [], false, {
				request: (path) => {
					if (path === "projects.getPRDetails") return details;
					if (path === "aiReview.getReviewDrafts") {
						draftReads++;
						if (scenario === "missing") return [];
						if (scenario === "loading") return pending.then(() => [draft]);
						if (scenario === "error") throw new Error("Draft store unavailable");
						if (scenario === "fresh" && draftReads === 1) return [];
						return [draft];
					}
					if (path === "aiReview.getReviewDraft") return scenario === "missing" ? null : draft;
					if (path === "reviewPath.jobs") return [job];
					if (path === "reviewPath.status")
						return {
							identity: { ...job.identity, headSha: head },
							status: "none",
							...(scenario === "missing" ? { reviewDraftId: draft.id } : {}),
						};
					if (path === "reviewPath.get")
						return {
							identity: { ...job.identity, headSha: head },
							path: null,
							pathVersion: 0,
							conversationId: "c",
							runs: [],
							questions: [],
							messages: [],
						};
					if (path === "github.getStatus") return { connected: false };
					if (path === "atlassian.getStatus") return { bitbucket: { connected: false } };
					if (path === "aiReview.getSettings") return { cliPreset: "codex" };
					if (path.endsWith("Settings"))
						return { autoMapOnReviewRequest: false, alsoReview: true, defaultRailMode: "auto" };
					return [];
				},
			});
			try {
				await h.settle();
				await h.settle();
				await act(async () =>
					[...h.container.querySelectorAll("button")]
						.find((b) => b.textContent?.trim() === "Review findings")
						?.click()
				);
				await h.settle();
				if (scenario === "loading") {
					expect(h.container.textContent).toContain("Loading agent findings…");
					expect(h.container.textContent).not.toContain("No agent findings for this revision.");
					await act(async () => release?.());
					await h.settle();
					await h.settle();
				}
				await h.settle();
				expect(useTabStore.getState().getActiveTabId()).toBe(`pr-review:${workspaceId}`);
				expect(ui.getState().panel).toBeNull();
				if (["finding", "loading", "fresh"].includes(scenario)) {
					expect(h.container.querySelector('[data-diff="finding.ts"]')?.textContent).toContain(
						"Agent finding body"
					);
					expect(
						usePRReviewSessionStore
							.getState()
							.sessions.get(prReviewSessionKey(workspaceId, "org/repo#10"))?.activeThreadId
					).toContain("finding-comment");
				} else
					expect(h.container.textContent).toContain(
						scenario === "empty" || scenario === "missing"
							? "No agent findings for this revision."
							: scenario === "error"
								? "Could not load agent findings. Refresh the PR and try again."
								: "These findings belong to an older revision."
					);
				expect(ui.getState().findingsRequest).toBeNull();
				expect(h.container.textContent).not.toContain("Loading agent findings…");
				expect(h.calls.some((c) => c.path === "reviewPath.startJob")).toBe(false);
			} finally {
				await h.cleanup();
			}
		}
	);
}
