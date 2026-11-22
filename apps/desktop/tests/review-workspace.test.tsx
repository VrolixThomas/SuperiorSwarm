import { expect, mock, test } from "bun:test";
import { act } from "react";
import type { GitHubPRDetails, PRContext } from "../src/shared/github-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (
	inIsolatedFileBrowserTest(import.meta.path, "default review workspace integration in isolation")
) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	mock.module("../src/renderer/components/review-mode/step/StepDiff", () => ({
		StepDiff: ({ filePath, header }: { filePath: string; header: import("react").ReactNode }) => (
			<div data-diff={filePath}>{header}</div>
		),
	}));
	mock.module("../src/renderer/components/review-mode/step/ContextFileView", () => ({
		ContextFileView: ({ step }: { step: { path: string } }) => (
			<div data-review-context-editor data-context={step.path}>
				Context
				<textarea className="inputarea" />
			</div>
		),
	}));
	const { ReviewWorkspace } = await import(
		"../src/renderer/components/review-mode/ReviewWorkspace"
	);
	const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
	const { useTabStore } = await import("../src/renderer/stores/tab-store");
	const { usePRReviewSessionStore } = await import(
		"../src/renderer/stores/pr-review-session-store"
	);
	const { useReviewPathSettingsStore } = await import(
		"../src/renderer/stores/review-path-settings-store"
	);
	const { PR129_PATH, PR129_FILES } = await import("../src/renderer/lib/review-path-fixtures");
	const prCtx: PRContext = {
		provider: "github",
		owner: "fixture",
		repo: "SuperiorSwarm",
		number: 129,
		title: "Review flow",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath: "/fixture",
	};
	const details: GitHubPRDetails = {
		title: prCtx.title,
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
		files: PR129_FILES,
		sourceBranch: "feature",
		targetBranch: "main",
		headCommitOid: PR129_PATH.headSha,
	};
	function reset() {
		useReviewModeStore.getState().close();
		usePRReviewSessionStore.setState({ sessions: new Map() });
		useReviewPathSettingsStore.setState({ defaultRailMode: "auto" });
		useReviewModeStore.getState().open("workspace", prCtx);
	}
	function request(path: string, input: unknown) {
		if (path === "projects.getPRDetails") return details;
		if (path === "github.getStatus") return { connected: false };
		if (path === "atlassian.getStatus") return { bitbucket: { connected: false } };
		if (path === "aiReview.getSettings") return { cliPreset: "codex" };
		if (path === "reviewPath.getSettings" || path === "reviewPath.importLegacySettings") {
			const state = useReviewPathSettingsStore.getState();
			return {
				autoMapOnReviewRequest: state.autoMapOnReviewRequest,
				alsoReview: state.alsoReview,
				defaultRailMode: state.defaultRailMode,
			};
		}
		if (path === "reviewPath.updateSettings") return input;
		if (path === "github.markFileViewed") return { success: true };
		return [];
	}
	async function key(value: string) {
		await act(async () => {
			document.body.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: value, bubbles: true })
			);
		});
	}
	test("default workspace opens overview then navigates files and marks only on explicit viewed key", async () => {
		reset();
		const h = await renderBrowserTest(
			<ReviewWorkspace active={{ workspaceId: "workspace", prCtx }} />,
			[],
			false,
			{ request }
		);
		try {
			await h.settle();
			expect(h.container.textContent).toContain("Description");
			expect(h.container.textContent).toContain(
				"The provider could not resolve the full PR revision"
			);
			await key("j");
			expect(h.container.querySelector("[data-diff]")).not.toBeNull();
			expect(h.calls.filter((c) => c.path === "github.markFileViewed")).toHaveLength(0);
			await key("v");
			await h.settle();
			expect(h.calls.filter((c) => c.path === "github.markFileViewed")).toHaveLength(1);
			await key("t");
			expect(h.container.querySelector('[aria-label="Review threads"]')).not.toBeNull();
			await key("Escape");
			expect(useReviewModeStore.getState().panel).toBeNull();
			expect(useReviewModeStore.getState().active).not.toBeNull();
		} finally {
			await h.cleanup();
		}
	});
	test("overview actions open changed files and the requested discussion filter", async () => {
		reset();
		const h = await renderBrowserTest(
			<ReviewWorkspace active={{ workspaceId: "workspace", prCtx }} />,
			[],
			false,
			{
				request: (path, input) =>
					path === "projects.getPRDetails"
						? {
								...details,
								reviewThreads: [
									{
										id: "resolved-thread",
										isResolved: true,
										path: PR129_FILES[0]?.path ?? "",
										line: 1,
										diffSide: "RIGHT",
										comments: [
											{
												id: "comment",
												body: "Resolved discussion",
												author: "reviewer",
												authorAvatarUrl: "",
												createdAt: "2026-11-21T00:00:00Z",
											},
										],
									},
								],
							}
						: request(path, input),
			}
		);
		try {
			await h.settle();
			await act(async () =>
				Array.from(h.container.querySelectorAll("button"))
					.find((button) => button.textContent?.includes("Resolved threads"))
					?.click()
			);
			expect(useReviewModeStore.getState().commentFilter).toBe("resolved");
			expect(
				h.container.querySelector('[data-filter="resolved"]')?.getAttribute("aria-pressed")
			).toBe("true");
			await key("Escape");
			await act(async () =>
				Array.from(h.container.querySelectorAll("button"))
					.find((button) => button.textContent?.includes("Browse changed files"))
					?.click()
			);
			expect(h.container.querySelector("[data-diff]")).not.toBeNull();
			expect(h.calls.filter((call) => call.path === "github.markFileViewed")).toHaveLength(0);
		} finally {
			await h.cleanup();
		}
	});
	test("agent action opens a workspace tab even when a legacy drawer was left open", async () => {
		reset();
		useTabStore.setState({ activeWorkspaceId: "workspace", sidebarSegment: "prs" });
		useReviewModeStore
			.getState()
			.setTerminal({ workspaceId: "workspace", tabId: "review-path:existing:1", cwd: "/fixture" });
		useReviewModeStore.getState().setDrawerOpen(true);
		const h = await renderBrowserTest(
			<ReviewWorkspace active={{ workspaceId: "workspace", prCtx }} />,
			[],
			false,
			{ request }
		);
		try {
			await h.settle();
			expect(h.container.textContent).not.toContain("AI review terminal");
			expect(h.container.querySelector('[aria-label="Resize AI review terminal"]')).toBeNull();
			await act(async () =>
				Array.from(h.container.querySelectorAll("button"))
					.find((button) => button.textContent === "Agent workspace")
					?.click()
			);
			expect(useReviewModeStore.getState().view).toBe("terminal");
			expect(useReviewModeStore.getState().drawerOpen).toBe(false);
			expect(
				useTabStore
					.getState()
					.getTabsByWorkspace("workspace")
					.some((tab) => tab.id === "review-path:existing:1" && tab.kind === "terminal")
			).toBe(true);
			expect(h.calls.some((call) => call.path === "reviewPath.start")).toBe(false);
		} finally {
			await h.cleanup();
		}
	});
	test.each(["preparing", "ended"])(
		"agent navigation follows the current run: %s",
		async (phase) => {
			reset();
			const head = (phase === "preparing" ? "e" : "d").repeat(40);
			useTabStore.setState({ activeWorkspaceId: "workspace", sidebarSegment: "prs" });
			useReviewModeStore.setState({ terminals: {} });
			const identity = {
				workspaceId: "workspace",
				provider: "github",
				owner: prCtx.owner,
				repo: prCtx.repo,
				prNumber: prCtx.number,
				headSha: head,
			};
			if (phase === "preparing")
				useReviewModeStore
					.getState()
					.setTerminal({ workspaceId: "workspace", tabId: "review-path:old:1", cwd: "/fixture" });
			const h = await renderBrowserTest(
				<ReviewWorkspace active={{ workspaceId: "workspace", prCtx }} />,
				[],
				false,
				{
					request: (path, input) => {
						if (path === "projects.getPRDetails") return { ...details, headCommitOid: head };
						if (path === "reviewPath.status") return { identity, status: "none" };
						if (path === "reviewPath.get")
							return {
								identity,
								path: null,
								pathVersion: 0,
								conversationId: "conversation",
								questions: [],
								messages: [],
								runs: [
									{
										identity,
										id: "old",
										version: 1,
										state: "completed",
										kind: "mapping",
										conversationId: "conversation",
										terminalId: "review-path:old:1",
									},
									...(phase === "preparing"
										? [
												{
													identity,
													id: "new",
													version: 2,
													state: "running",
													kind: "mapping",
													conversationId: "conversation",
												},
											]
										: []),
								],
							};
						return request(path, input);
					},
				}
			);
			try {
				await h.settle();
				if (phase === "preparing") expect(h.container.textContent).not.toContain("Agent workspace");
				else {
					expect(h.container.textContent).toContain("Agent workspace");
					await act(async () =>
						Array.from(h.container.querySelectorAll("button"))
							.find((button) => button.textContent === "Agent workspace")
							?.click()
					);
					expect(useReviewModeStore.getState().view).toBe("terminal");
					expect(
						h.calls.some(
							(call) =>
								call.path === "workspaces.attachTerminal" || call.path === "reviewPath.start"
						)
					).toBe(false);
				}
			} finally {
				await h.cleanup();
			}
		}
	);
	test("fixture path keyboard follows nested tests and never marks context viewed", async () => {
		reset();
		const h = await renderBrowserTest(
			<ReviewWorkspace active={{ workspaceId: "workspace", prCtx }} fixture />,
			[],
			false,
			{ request }
		);
		try {
			await h.settle();
			for (let i = 0; i < 3; i++) await key("j");
			expect(h.container.querySelector("[data-diff]")?.getAttribute("data-diff")).toBe(
				"apps/desktop/tests/pr-review-submit.test.ts"
			);
			for (let i = 0; i < 4; i++) await key("j");
			expect(h.container.querySelector("[data-context]")).not.toBeNull();
			await key("v");
			expect(h.calls.filter((c) => c.path === "github.markFileViewed")).toHaveLength(0);
			await act(async () =>
				h.container
					.querySelector("textarea.inputarea")
					?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "t", bubbles: true }))
			);
			expect(useReviewModeStore.getState().panel).toBe("threads");
			await key("Escape");
			await key("f");
			await h.settle();
			expect(useReviewPathSettingsStore.getState().defaultRailMode).toBe("files");
		} finally {
			await h.cleanup();
		}
	});
}
