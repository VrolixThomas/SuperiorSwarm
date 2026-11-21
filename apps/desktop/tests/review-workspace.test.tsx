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
	mock.module("../src/renderer/components/review-mode/TerminalDrawer", () => ({
		TerminalDrawer: () => null,
		TerminalTab: () => null,
	}));
	const { ReviewWorkspace } = await import(
		"../src/renderer/components/review-mode/ReviewWorkspace"
	);
	const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
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
	function request(path: string) {
		if (path === "projects.getPRDetails") return details;
		if (path === "github.getStatus") return { connected: false };
		if (path === "atlassian.getStatus") return { bitbucket: { connected: false } };
		if (path === "aiReview.getSettings") return { cliPreset: "codex" };
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
			expect(h.container.textContent).toContain("Reading-path agent is not connected yet");
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
			expect(useReviewPathSettingsStore.getState().defaultRailMode).toBe("files");
		} finally {
			await h.cleanup();
		}
	});
}
