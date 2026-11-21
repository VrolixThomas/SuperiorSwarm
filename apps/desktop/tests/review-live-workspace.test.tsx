import { expect, mock, test } from "bun:test";
import { act } from "react";
import type { GitHubPRDetails, PRContext } from "../src/shared/github-types";
import type { ReviewPathSnapshot } from "../src/shared/review-path-runtime";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "live workspace connection glue in isolation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	mock.module("../src/renderer/components/review-mode/step/StepDiff", () => ({
		StepDiff: () => <div>Diff</div>,
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
	const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
	const { useReviewPathSettingsStore } = await import(
		"../src/renderer/stores/review-path-settings-store"
	);
	const prCtx: PRContext = {
		provider: "github",
		owner: "org",
		repo: "repo",
		number: 5,
		title: "Live review",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath: "/repo",
	};
	const identity = {
		workspaceId: "connected-review",
		provider: "github" as const,
		owner: "org",
		repo: "repo",
		prNumber: 5,
		headSha: "a".repeat(40),
	};
	const settings = {
		autoMapOnReviewRequest: false,
		alsoReview: true,
		defaultRailMode: "auto" as const,
	};
	const details: GitHubPRDetails = {
		title: prCtx.title,
		body: "Live details",
		state: "OPEN",
		isDraft: false,
		author: "author",
		authorAvatarUrl: "",
		reviewDecision: null,
		ciState: null,
		checks: [],
		reviewers: [],
		conversationComments: [],
		files: [{ path: "file.ts", additions: 1, deletions: 0, changeType: "MODIFIED" }],
		sourceBranch: "feature",
		targetBranch: "main",
		headCommitOid: identity.headSha,
		baseCommitOid: "b".repeat(40),
		reviewThreads: [
			{
				id: "mine",
				path: "file.ts",
				line: 1,
				diffSide: "RIGHT",
				isResolved: false,
				comments: [
					{
						id: "c",
						body: "My thread",
						author: "same-display",
						authorId: "42",
						authorAvatarUrl: "",
						createdAt: "",
					},
				],
			},
			{
				id: "other",
				path: "file.ts",
				line: 2,
				diffSide: "RIGHT",
				isResolved: false,
				comments: [
					{
						id: "o",
						body: "Other account",
						author: "same-display",
						authorId: "99",
						authorAvatarUrl: "",
						createdAt: "",
					},
				],
			},
		],
	};
	test("manual Map and Ask use live full identity and attach existing terminals; Mine uses account ID", async () => {
		let snapshot: ReviewPathSnapshot = {
			identity,
			path: null,
			pathVersion: 0,
			conversationId: "conversation",
			runs: [],
			questions: [],
			messages: [],
		};
		useReviewModeStore.setState({ terminals: {}, drawerOpen: false });
		useReviewModeStore.getState().open(identity.workspaceId, prCtx);
		useReviewPathSettingsStore.setState({ ...settings, connected: false });
		let terminalWrites = 0;
		const h = await renderBrowserTest(
			<ReviewWorkspace active={{ workspaceId: identity.workspaceId, prCtx }} />,
			[],
			false,
			{
				electron: { terminal: { write: () => terminalWrites++ } },
				request: (path, input) => {
					if (path === "projects.getPRDetails") return details;
					if (path === "github.getStatus")
						return { connected: true, accountId: "42", displayName: "untrusted name" };
					if (path === "atlassian.getStatus") return { bitbucket: { connected: false } };
					if (path === "github.getCurrentReviewer")
						return {
							...(input as object),
							provider: "github",
							status: "available",
							identity: { id: "42", login: "verified-login" },
						};
					if (path === "aiReview.getSettings") return { cliPreset: "codex" };
					if (path.startsWith("reviewPath.") && path.endsWith("Settings")) return settings;
					if (path === "reviewPath.get") return snapshot;
					if (path === "workspaces.attachTerminal") return { success: true };
					if (path === "reviewPath.start") {
						expect(input).toMatchObject({ identity, agent: { id: "codex" }, alsoReview: true });
						snapshot = {
							...snapshot,
							path: {
								id: "path",
								prKey: "org/repo#5",
								headSha: identity.headSha,
								agent: { id: "codex", label: "Codex" },
								status: "mapping",
								entries: [],
								otherFiles: ["file.ts"],
								updatedAt: new Date().toISOString(),
							},
						};
						return {
							snapshot,
							launch: {
								terminalId: "review-path:map:1",
								reviewWorkspaceId: identity.workspaceId,
								worktreePath: "/review-worktree",
								launchScript: "never-launch-twice.sh",
							},
						};
					}
					if (path === "reviewPath.ask") {
						expect(input).toMatchObject({ identity, text: "Why this change?" });
						return {
							snapshot,
							launch: {
								terminalId: "review-path:ask:1",
								reviewWorkspaceId: identity.workspaceId,
								worktreePath: "/review-worktree",
							},
						};
					}
					return [];
				},
			}
		);
		try {
			await h.settle();
			await h.settle();
			const map = [...h.container.querySelectorAll("button")].find(
				(button) => button.textContent === "Map this PR"
			);
			expect(map?.disabled).toBe(false);
			await act(async () => map?.click());
			await h.settle();
			expect(useReviewModeStore.getState().terminals[identity.workspaceId]?.tabId).toBe(
				"review-path:map:1"
			);
			expect(useReviewModeStore.getState().drawerOpen).toBe(false);
			await act(async () => useReviewModeStore.getState().setPanel("threads"));
			const mine = h.container.querySelector<HTMLButtonElement>('[data-filter="mine"]');
			expect(mine?.disabled).toBe(false);
			await act(async () => mine?.click());
			expect(h.container.querySelector('[data-thread-id="mine"]')).not.toBeNull();
			expect(h.container.querySelector('[data-thread-id="other"]')).toBeNull();
			await act(async () => useReviewModeStore.getState().setPanel("ask"));
			const textarea = h.container.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Ask a follow-up"]'
			);
			await act(async () => {
				if (textarea) {
					Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
						textarea,
						"Why this change?"
					);
					textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
					textarea.dispatchEvent(new window.Event("change", { bubbles: true }));
				}
			});
			await act(async () =>
				h.container.querySelector<HTMLButtonElement>('button[aria-label="Send question"]')?.click()
			);
			await h.settle();
			expect(h.calls.filter((call) => call.path === "reviewPath.ask")).toHaveLength(1);
			expect(terminalWrites).toBe(0);
		} finally {
			await h.cleanup();
		}
	});
}
