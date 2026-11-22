import { expect, mock, test } from "bun:test";
import { act } from "react";
import type { GitHubPRDetails, PRContext } from "../src/shared/github-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "V4 independent renderer boundary probes")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	mock.module("../src/renderer/components/review-mode/step/StepDiff", () => ({
		StepDiff: ({ filePath, readOnly }: { filePath: string; readOnly: boolean }) => (
			<div data-v4-diff={filePath} data-read-only={String(readOnly)} />
		),
	}));
	mock.module("../src/renderer/components/review-mode/step/ContextFileView", () => ({
		ContextFileView: () => null,
	}));
	mock.module("../src/renderer/components/review-mode/TerminalDrawer", () => ({
		TerminalDrawer: () => null,
		TerminalTab: () => null,
	}));
	const { ReviewWorkspace } = await import(
		"../src/renderer/components/review-mode/ReviewWorkspace"
	);
	const { ReviewWorkspaceTopBar } = await import(
		"../src/renderer/components/review-mode/ReviewWorkspaceTopBar"
	);
	const { AllPRsDrawer } = await import(
		"../src/renderer/components/review-mode/queue/AllPRsDrawer"
	);
	const { useReviewData } = await import("../src/renderer/components/review-mode/useReviewData");
	const { stepThreadLayout } = await import(
		"../src/renderer/components/review-mode/step/step-diff-model"
	);
	const { openThreadInChanges } = await import("../src/renderer/lib/review-mode-nav");
	const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
	const { usePRReviewSessionStore } = await import(
		"../src/renderer/stores/pr-review-session-store"
	);
	const pr: PRContext = {
		provider: "github",
		owner: "v4",
		repo: "renderer",
		number: 4,
		title: "V4 review",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath: "/disposable",
	};
	const head = "b".repeat(40);
	const details: GitHubPRDetails = {
		title: "V4 review",
		body: "Overview body",
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
		files: [{ path: "a.ts", additions: 1, deletions: 1, changeType: "MODIFIED" }],
		sourceBranch: "feature",
		targetBranch: "main",
		headCommitOid: head,
		baseCommitOid: "c".repeat(40),
	};
	const settings = { autoMapOnReviewRequest: false, alsoReview: false, defaultRailMode: "auto" };
	function request(path: string, input: unknown): unknown {
		if (path === "projects.getPRDetails") return details;
		if (path === "github.getStatus") return { connected: false };
		if (path === "atlassian.getStatus") return { bitbucket: { connected: false } };
		if (path === "projects.getByRepo") return [{ id: "v4-project", repoPath: "/disposable" }];
		if (path === "aiReview.getSettings") return { cliPreset: "codex" };
		if (path.startsWith("reviewPath.") && path.endsWith("Settings")) return settings;
		if (path === "reviewPath.get")
			return {
				identity: (input as { identity: unknown }).identity,
				path: null,
				pathVersion: 0,
				conversationId: "v4-conv",
				runs: [],
				questions: [],
				messages: [],
			};
		return [];
	}
	function reset(workspaceId: string) {
		useReviewModeStore.setState({
			active: null,
			lastWorkspaceId: null,
			terminals: {},
			drawerOpen: false,
		});
		usePRReviewSessionStore.setState({ sessions: new Map() });
		useReviewModeStore.getState().open(workspaceId, pr);
	}

	test("V4: an attached Ask terminal remains reachable when mapping and legacy review are idle", async () => {
		let opened = 0;
		const props = {
			prCtx: pr,
			data: {
				details,
				agentActions: {
					isReviewActive: false,
					isPending: false,
					label: "Start Review",
					trigger: () => {},
					cancel: null,
				},
				canSubmitReview: true,
				submitOpen: false,
				setSubmitOpen: () => {},
			},
			source: { status: "none", path: null },
			queue: { queue: { needsReview: [], waitingOnAuthor: [] }, next: null, openingKey: null },
			onNextPR: () => {},
			openTerminal: () => {
				opened++;
			},
		};
		const h = await renderBrowserTest(
			<ReviewWorkspaceTopBar
				{...(props as unknown as Parameters<typeof ReviewWorkspaceTopBar>[0])}
			/>,
			[],
			false,
			{ request }
		);
		try {
			// Every other top-bar callback is inert/local. This tests reachability without assuming a label.
			await act(async () => {
				for (const button of h.container.querySelectorAll("button")) button.click();
			});
			expect(opened).toBeGreaterThan(0);
		} finally {
			await h.cleanup();
		}
	});

	test("V4: opening a Changes deep link while overview is visible must show the requested file", async () => {
		const workspaceId = "v4-deep-link";
		reset(workspaceId);
		const h = await renderBrowserTest(
			<ReviewWorkspace active={{ workspaceId, prCtx: pr }} />,
			[],
			false,
			{ request }
		);
		try {
			await h.settle();
			await act(async () => useReviewModeStore.getState().setOverviewOpen(true));
			expect(h.container.textContent).toContain("Overview body");
			await act(async () => openThreadInChanges(workspaceId, pr, "a.ts", "thread-link"));
			await h.settle();
			expect(h.container.querySelector('[data-v4-diff="a.ts"]')).not.toBeNull();
		} finally {
			await h.cleanup();
		}
	});

	test("V4: reopening an automatically mapped PR must recover its owned terminal from persisted runs", async () => {
		const workspaceId = "v4-auto-terminal";
		reset(workspaceId);
		const h = await renderBrowserTest(
			<ReviewWorkspace active={{ workspaceId, prCtx: pr }} />,
			[],
			false,
			{
				request: (path, input) => {
					if (path !== "reviewPath.get") return request(path, input);
					const identity = (input as { identity: unknown }).identity;
					return {
						identity,
						path: {
							id: "automatic-map",
							prKey: "v4/renderer#4",
							headSha: head,
							agent: { id: "codex", label: "Codex" },
							status: "mapping",
							entries: [],
							otherFiles: ["a.ts"],
							updatedAt: new Date().toISOString(),
						},
						pathVersion: 1,
						conversationId: "auto-conversation",
						runs: [
							{
								identity,
								id: "automatic-run",
								version: 1,
								kind: "mapping",
								state: "running",
								conversationId: "auto-conversation",
								terminalId: "review-path:automatic-run:1",
							},
						],
						questions: [],
						messages: [],
					};
				},
			}
		);
		try {
			await h.settle();
			const mapping = [...h.container.querySelectorAll("button")].find((button) =>
				button.textContent?.startsWith("Mapping ·")
			);
			expect(mapping).toBeDefined();
			expect(mapping?.disabled).toBe(false);
		} finally {
			await h.cleanup();
		}
	});

	test("V4: All PRs can show a known mapped non-current review instead of losing its live identity", async () => {
		const workspaceId = "v4-queue-state";
		reset(workspaceId);
		const h = await renderBrowserTest(
			<ReviewWorkspace active={{ workspaceId, prCtx: pr }} />,
			[],
			false,
			{
				request: (path, input) => {
					if (path !== "reviewPath.get") return request(path, input);
					return {
						identity: (input as { identity: unknown }).identity,
						path: {
							id: "known-path",
							prKey: "v4/renderer#4",
							headSha: head,
							agent: { id: "codex", label: "Codex" },
							status: "ready",
							entries: [],
							otherFiles: ["a.ts"],
							updatedAt: new Date().toISOString(),
						},
						pathVersion: 1,
						conversationId: "queue-conversation",
						runs: [],
						questions: [],
						messages: [],
					};
				},
			}
		);
		try {
			await h.settle();
			expect(h.container.textContent).toContain("entry points");
			await h.rerender(
				<AllPRsDrawer
					queue={{
						needsReview: [
							{ ...pr, key: "github:v4/renderer#4", projectId: "v4-project", headCommitSha: head },
						],
						waitingOnAuthor: [],
					}}
					currentKey="github:v4/renderer#99"
					onClose={() => {}}
					onSelect={() => {}}
				/>
			);
			expect(h.container.textContent).toContain("Path ready");
		} finally {
			await h.cleanup();
		}
	});

	test("V4: an old-head local finding must not enter the new-head inline layout as current", async () => {
		const oldDraft = {
			id: "v4-old-draft",
			prProvider: "github",
			prIdentifier: "v4/renderer#4",
			status: "ready",
			commitSha: "a".repeat(40),
			roundNumber: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		let observed: ReturnType<typeof useReviewData> | undefined;
		function Probe() {
			observed = useReviewData("v4-stale", pr);
			return null;
		}
		const h = await renderBrowserTest(<Probe />, [], false, {
			request: (path, input) => {
				if (path === "aiReview.getReviewDrafts") return [oldDraft];
				if (path === "aiReview.getReviewDraft")
					return {
						...oldDraft,
						comments: [
							{
								id: "stale-finding",
								filePath: "a.ts",
								lineNumber: 12,
								side: "RIGHT",
								body: "Old code was wrong",
								status: "pending",
								createdAt: new Date().toISOString(),
							},
						],
					};
				return request(path, input);
			},
		});
		try {
			await h.settle();
			expect(observed?.details?.headCommitOid).toBe(head);
			expect(observed?.aiDraft?.commitSha).not.toBe(head);
			expect(observed?.allThreads).toHaveLength(1);
			const layout = stepThreadLayout(observed?.allThreads ?? [], "split", true, {
				LEFT: 40,
				RIGHT: 40,
			});
			expect(
				[...layout.leftInline, ...layout.rightInline].some(
					(thread) => thread.isAIDraft && thread.draftCommentId === "stale-finding"
				)
			).toBe(false);
		} finally {
			await h.cleanup();
		}
	});

	for (const state of ["CLOSED", "MERGED"] as const) {
		test(`V4: ${state} PR disables review mutations and passes read-only to its diff`, async () => {
			const workspaceId = `v4-${state}`;
			reset(workspaceId);
			openThreadInChanges(workspaceId, pr, "a.ts");
			const h = await renderBrowserTest(
				<ReviewWorkspace active={{ workspaceId, prCtx: pr }} />,
				[],
				false,
				{
					request: (path, input) =>
						path === "projects.getPRDetails" ? { ...details, state } : request(path, input),
				}
			);
			try {
				await h.settle();
				expect(h.container.textContent).toContain(`This pull request is ${state.toLowerCase()}`);
				expect(h.container.querySelector("[data-v4-diff]")?.getAttribute("data-read-only")).toBe(
					"true"
				);
				expect(
					[...h.container.querySelectorAll("button")].find(
						(button) => button.textContent === "Submit review"
					)?.disabled
				).toBe(true);
				// The refreshed review header has one Map entry instead of a duplicate legacy launcher.
				expect(
					[...h.container.querySelectorAll("button")].filter(
						(button) => button.textContent === "Start Review" && !button.disabled
					)
				).toEqual([]);
				expect(h.calls.some((call) => call.path === "aiReview.triggerReview")).toBe(false);
			} finally {
				await h.cleanup();
			}
		});
	}
}
