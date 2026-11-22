import { expect, mock, test } from "bun:test";
import { act } from "react";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "queue actions in scoped reading workspace")) {
	let direct = 0;
	const prepared: unknown[] = [];
	let canceled = 0;
	const invalidate = async () => {};
	const mutation = () => ({ mutate: () => direct++ });
	mock.module("../src/renderer/trpc/client", () => ({
		trpc: {
			createClient: () => ({}),
			Provider: ({ children }: { children: React.ReactNode }) => children,
			useUtils: () => ({
				aiReview: { getReviewDrafts: { invalidate }, getReviewDraft: { invalidate } },
				projects: { getPRDetails: { invalidate } },
				reviewExplanation: {
					resolveSnapshot: { invalidate },
					getSnapshotFile: { invalidate },
					getSnapshotContext: { invalidate },
				},
				github: { getMyPRs: { invalidate } },
				atlassian: { getReviewRequests: { invalidate } },
			}),
			aiReview: {
				updateDraftComment: { useMutation: mutation },
				deleteDraftComment: { useMutation: mutation },
			},
			github: {
				addReviewComment: { useMutation: mutation },
				resolveThread: { useMutation: mutation },
			},
			atlassian: {
				replyToPRComment: { useMutation: mutation },
				resolvePRComment: { useMutation: mutation },
			},
			workspaces: { cleanupReviewWorkspace: { useMutation: mutation } },
		},
		trpcVanilla: {
			activityQueue: {
				prPublicationPrepare: {
					mutate: async (input: unknown) => {
						prepared.push(input);
						return { status: "pending", notBefore: Date.now() + 5000 };
					},
				},
				prPublicationCancel: {
					mutate: async () => {
						canceled++;
						return { status: "cancelled" };
					},
				},
				prPublicationDispatch: {
					mutate: async () => {
						throw Error("Must not dispatch during Undo");
					},
				},
			},
		},
	}));
	mock.module("../src/renderer/components/review-mode/useReviewData", () => ({
		useReviewData: () => ({
			details: { state: "OPEN", headCommitOid: "head" },
			aiDraft: null,
			allThreads: [],
			acceptedThreads: [],
			counts: {},
			pendingCount: 0,
			sessionKey: "scope",
			fileOrder: [],
		}),
	}));
	mock.module("../src/renderer/components/review-mode/useReviewAgentActions", () => ({
		useReviewAgentActions: () => ({}),
	}));
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
	const { useTabStore } = await import("../src/renderer/stores/tab-store");
	const { ReviewUIProvider, reviewUIScopeKey } = await import(
		"../src/renderer/components/review-mode/ReviewUIContext"
	);
	const { useReviewWorkspaceData } = await import(
		"../src/renderer/components/review-mode/useReviewWorkspaceData"
	);
	const prCtx = {
		provider: "github" as const,
		owner: "fixture",
		repo: "repo",
		number: 7,
		title: "PR",
		sourceBranch: "feat",
		targetBranch: "main",
		repoPath: "/tmp/repo",
	};
	const review = { workspaceId: "workspace-a", prCtx };
	function Probe() {
		const data = useReviewWorkspaceData(review.workspaceId, prCtx);
		return (
			<>
				<button
					type="button"
					onClick={() =>
						void Promise.resolve(data.callbacks.onReply?.("thread", "reply")).catch(() => {})
					}
				>
					Reply
				</button>
				<button type="button" onClick={() => data.callbacks.onResolve?.("thread")}>
					Resolve
				</button>
				{data.publicationNotice}
				{data.publicationError && <output>{data.publicationError}</output>}
			</>
		);
	}
	for (const action of ["Reply", "Resolve"] as const)
		test(`scoped ${action} uses Queue Undo rather than the legacy immediate mutation`, async () => {
			direct = 0;
			prepared.length = 0;
			canceled = 0;
			useReviewModeStore.getState().open(review.workspaceId, prCtx);
			useReviewModeStore
				.getState()
				.setQueueOrigin({ id: "queue-a", revision: 3, workspaceId: review.workspaceId });
			useReviewModeStore.getState().open("workspace-b", { ...prCtx, number: 8 });
			useReviewModeStore
				.getState()
				.setQueueOrigin({ id: "queue-b", revision: 8, workspaceId: "workspace-b" });
			useTabStore.setState({ sidebarSegment: "prs", activeWorkspaceId: review.workspaceId });
			const h = await renderBrowserTest(
				<ReviewUIProvider scopeKey={reviewUIScopeKey(review)} review={review}>
					<Probe />
				</ReviewUIProvider>
			);
			try {
				await act(async () =>
					h.container
						.querySelector<HTMLButtonElement>(action === "Reply" ? "button" : "button:nth-child(2)")
						?.click()
				);
				expect(direct).toBe(0);
				expect(prepared).toHaveLength(1);
				expect(prepared[0]).toMatchObject({
					origin: { id: "queue-a", revision: 3 },
					operation: { kind: action === "Reply" ? "reply" : "resolve", commentId: "thread" },
				});
				expect(h.container.textContent).toContain("Publication waits five seconds");
				await act(async () =>
					Array.from(h.container.querySelectorAll("button"))
						.find((button) => button.textContent === "Undo publication")
						?.click()
				);
				expect(canceled).toBe(1);
				expect(direct).toBe(0);
			} finally {
				await h.cleanup();
			}
		});
}
