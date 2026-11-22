import { expect, test } from "bun:test";
import { act } from "react";
import type { GitHubPRDetails, PRContext } from "../src/shared/github-types";
import type { ReviewPathSnapshot } from "../src/shared/review-path-runtime";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "authoritative review wiring renderer")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { useReviewData } = await import("../src/renderer/components/review-mode/useReviewData");
	const { useReviewConnections } = await import(
		"../src/renderer/components/review-mode/hooks/useReviewConnections"
	);
	const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
	const { setReviewDraftBinding } = await import("../src/renderer/lib/review-draft-binding");
	const { AllPRsDrawer } = await import(
		"../src/renderer/components/review-mode/queue/AllPRsDrawer"
	);
	const { canAcceptDraft, canEditDraft, mapDraftComment, pickLatestDraft } = await import(
		"../src/renderer/lib/pr-review-threads"
	);
	const { stepThreadLayout } = await import(
		"../src/renderer/components/review-mode/step/step-diff-model"
	);
	const pr: PRContext = {
		provider: "github",
		owner: "wire",
		repo: "repo",
		number: 8,
		title: "Wiring",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath: "/disposable",
	};
	const identity = {
		workspaceId: "wiring",
		provider: pr.provider,
		owner: pr.owner,
		repo: pr.repo,
		prNumber: pr.number,
		headSha: "a".repeat(40),
	};
	const details: GitHubPRDetails = {
		title: "Wiring",
		body: "",
		state: "OPEN",
		isDraft: false,
		author: "a",
		authorAvatarUrl: "",
		reviewDecision: null,
		ciState: null,
		checks: [],
		reviewers: [],
		reviewThreads: [],
		conversationComments: [],
		files: [],
		sourceBranch: "feature",
		targetBranch: "main",
		headCommitOid: identity.headSha,
	};
	const draft = (id: string, status = "ready", roundNumber = 1) => ({
		id,
		prProvider: pr.provider,
		prIdentifier: "wire/repo#8",
		status,
		roundNumber,
		reviewChainId: id,
		commitSha: identity.headSha,
		createdAt: new Date().toISOString(),
		comments: [
			{
				id: `${id}-finding`,
				filePath: "a.ts",
				lineNumber: 12,
				side: "LEFT",
				body: id,
				status: "pending",
				createdAt: new Date().toISOString(),
			},
		],
	});
	const snapshot: ReviewPathSnapshot = {
		identity,
		path: null,
		pathVersion: 1,
		conversationId: "c",
		questions: [],
		messages: [],
		runs: [
			{
				identity,
				id: "mapping",
				kind: "mapping",
				state: "running",
				version: 2,
				conversationId: "c",
				reviewDraftId: "new",
				terminalId: "review-path:mapping:2",
			},
		],
	};

	test("bound active mapping beats unrelated higher-round ready draft before list polling; manual binding remains reachable", async () => {
		let observed: ReturnType<typeof useReviewData> | undefined;
		function Probe() {
			observed = useReviewData(identity.workspaceId, pr);
			return null;
		}
		const h = await renderBrowserTest(<Probe />, [], false, {
			request: (path, input) => {
				if (path === "projects.getPRDetails") return details;
				if (path === "reviewPath.get") return snapshot;
				if (path === "reviewPath.status")
					return { identity, status: "mapping", reviewDraftId: "new" };
				if (path === "aiReview.getReviewDrafts") return [draft("old", "ready", 50)];
				if (path === "aiReview.getReviewDraft")
					return draft((input as { draftId: string }).draftId, "in_progress");
				return [];
			},
		});
		try {
			await h.settle();
			expect(observed?.aiDraft?.id).toBe("new");
			expect(observed?.allThreads[0]?.id).toBe("ai-new-finding");
			await act(async () => setReviewDraftBinding(identity, "manual"));
			await h.settle();
			expect(observed?.aiDraft?.id).toBe("manual");
		} finally {
			await h.cleanup();
		}
	});

	test("historical draft anchors remain visible but cannot be accepted or mapped inline", () => {
		const thread = mapDraftComment(
			{
				id: "c",
				filePath: "a.ts",
				lineNumber: 12,
				side: "LEFT",
				body: "Old",
				status: "approved",
				createdAt: "",
			},
			1,
			{ draftId: "old", commitSha: "b".repeat(40), currentHead: identity.headSha }
		);
		expect(thread.originalLine).toBe(12);
		expect(thread.diffSide).toBe("LEFT");
		expect(canAcceptDraft(thread)).toBe(false);
		expect(canEditDraft(thread)).toBe(false);
		const layout = stepThreadLayout([thread], "split", true, { LEFT: 40, RIGHT: 40 });
		expect(layout.leftInline).toEqual([]);
		expect(layout.outdated).toEqual([thread]);
		expect(
			pickLatestDraft(
				[
					{ ...draft("old", "ready", 50), createdAt: "2020-01-01" },
					{ ...draft("new", "in_progress"), createdAt: "2021-01-01" },
				],
				"wire/repo#8"
			)?.id
		).toBe("new");
	});

	test("persisted owned terminal rehydrates a descriptor without attachment mutation or prompt and fences a changed head", async () => {
		let observed: ReturnType<typeof useReviewConnections> | undefined;
		function Probe({ head = identity.headSha }: { head?: string }) {
			observed = useReviewConnections(
				identity.workspaceId,
				pr,
				{ ...details, headCommitOid: head },
				false
			);
			return null;
		}
		useReviewModeStore.setState({ terminals: {}, drawerOpen: false });
		const h = await renderBrowserTest(<Probe />, [], false, {
			request: (path, input) => {
				if (path === "reviewPath.get") {
					const requested = (input as { identity: typeof identity }).identity;
					return {
						...snapshot,
						identity: requested,
						runs: requested.headSha === identity.headSha ? snapshot.runs : [],
					};
				}
				if (path === "reviewPath.status")
					return {
						identity,
						status: "mapping",
						terminal: {
							terminalId: "review-path:mapping:2",
							reviewWorkspaceId: identity.workspaceId,
							worktreePath: "/disposable/review",
						},
					};
				if (path === "github.getStatus") return { connected: false };
				return [];
			},
		});
		try {
			await h.settle();
			expect(observed?.terminal?.tabId).toBe("review-path:mapping:2");
			expect(observed?.terminal?.cwd).toBe("/disposable/review");
			expect(useReviewModeStore.getState().drawerOpen).toBe(false);
			expect(h.calls.some((call) => /start|ask|attachTerminal/.test(call.path))).toBe(false);
			await h.rerender(<Probe head={"b".repeat(40)} />);
			await h.settle();
			expect(observed?.terminal).toBeUndefined();
			expect(observed?.openTerminal).toBeUndefined();
		} finally {
			await h.cleanup();
		}
	});

	test("a never-opened queue row reads scoped status without creating a workspace", async () => {
		const h = await renderBrowserTest(
			<AllPRsDrawer
				queue={{
					needsReview: [
						{
							...pr,
							number: 99,
							key: "github:wire/repo#99",
							headCommitSha: identity.headSha,
							projectId: "p",
						},
					],
					waitingOnAuthor: [],
				}}
				currentKey="different"
				onClose={() => {}}
				onSelect={() => {}}
			/>,
			[],
			false,
			{
				request: (path, input) => {
					if (path === "reviewPath.status")
						return {
							identity: { ...(input as object), workspaceId: "never-opened" },
							status: "mapping",
						};
					return [];
				},
			}
		);
		try {
			await h.settle();
			expect(h.container.textContent).toContain("Mapping");
			expect(h.calls.find((call) => call.path === "reviewPath.status")?.input).toMatchObject({
				provider: "github",
				projectId: "p",
				prNumber: 99,
				headSha: identity.headSha,
			});
			expect(h.calls.some((call) => call.path.includes("getOrCreate"))).toBe(false);
		} finally {
			await h.cleanup();
		}
	});
	test("a submitted workspace binding cannot hide a new current-head manual draft after reload", async () => {
		const currentPr = { ...pr, number: 9 };
		const currentScope = { ...identity, workspaceId: "manual-after-submit", prNumber: 9 };
		const old = { ...draft("submitted-map", "submitted"), prIdentifier: "wire/repo#9" };
		const manual = { ...draft("new-manual"), prIdentifier: "wire/repo#9" };
		let observed: ReturnType<typeof useReviewData> | undefined;
		function Probe() {
			observed = useReviewData(currentScope.workspaceId, currentPr);
			return null;
		}
		const h = await renderBrowserTest(<Probe />, [], false, {
			request: (path, input) => {
				if (path === "projects.getPRDetails") return details;
				if (path === "reviewPath.status")
					return { identity: currentScope, status: "ready", reviewDraftId: old.id };
				if (path === "reviewPath.get") return { ...snapshot, identity: currentScope, runs: [] };
				if (path === "aiReview.getReviewDrafts") return [old, manual];
				if (path === "aiReview.getReviewDraft")
					return (input as { draftId: string }).draftId === old.id ? old : manual;
				return [];
			},
		});
		try {
			await h.settle();
			expect(observed?.aiDraft?.id).toBe(manual.id);
		} finally {
			await h.cleanup();
		}
	});
}
