import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
const browser = new Window({ url: "http://localhost" });
for (const [key, value] of Object.entries({
	window: browser,
	document: browser.document,
	navigator: browser.navigator,
	HTMLElement: browser.HTMLElement,
	Node: browser.Node,
	Event: browser.Event,
	IS_REACT_ACT_ENVIRONMENT: true,
}))
	Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
let direct = 0;
let prepared = 0;
let dispatchWait = 5000;
let deferredDispatch: (() => Promise<unknown>) | undefined;
const success = {
	status: "submitted",
	outcome: {
		success: true,
		postedCount: 1,
		failedCount: 0,
		skippedCount: 0,
		errors: [],
		verdictSubmitted: true,
	},
};
const mutation = () => ({
	mutate: () => {
		direct++;
	},
	mutateAsync: async () => {
		direct++;
		return {};
	},
	isPending: false,
});
mock.module("../src/renderer/trpc/client", () => ({
	trpc: {
		useUtils: () => ({
			aiReview: {
				getReviewDrafts: { invalidate: async () => {} },
				getReviewDraft: { invalidate: async () => {} },
			},
		}),
		aiReview: {
			updateDraftComment: { useMutation: mutation },
			submitReview: { useMutation: mutation },
		},
		review: { submitReview: { useMutation: mutation } },
	},
	trpcVanilla: {
		activityQueue: {
			prPublicationPrepare: {
				mutate: async () => {
					prepared++;
					return { status: "pending", notBefore: Date.now() + dispatchWait };
				},
			},
			prPublicationCancel: { mutate: async () => ({ status: "cancelled" }) },
			prPublicationDispatch: {
				mutate: async () => (deferredDispatch ? deferredDispatch() : success),
			},
		},
	},
}));
mock.module("../src/renderer/components/MarkdownRenderer", () => ({
	MarkdownRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}));
const { createRoot } = await import("react-dom/client");
const { useTabStore } = await import("../src/renderer/stores/tab-store");
const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
const { SubmitReviewPopover } = await import(
	"../src/renderer/components/review-mode/SubmitReviewPopover"
);
const { ThreadCard } = await import("../src/renderer/components/review-mode/thread/ThreadCard");
const ctx = {
	provider: "github" as const,
	owner: "owner",
	repo: "repo",
	number: 7,
	title: "PR",
	sourceBranch: "feature",
	targetBranch: "main",
	repoPath: "/tmp/fixture",
};
let root: Root;
async function mount(node: React.ReactNode) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(() => root.render(node));
}
async function click(text: string, last = false) {
	await act(async () => {
		const buttons = [...document.querySelectorAll("button")].filter((b) => b.textContent === text);
		const b = last ? buttons.at(-1) : buttons[0];
		if (!b) throw Error(`Missing ${text}`);
		b.click();
		await Promise.resolve();
	});
}
beforeEach(() => {
	dispatchWait = 5000;
	deferredDispatch = undefined;
	useReviewModeStore.setState({
		queueOrigins: {},
		queueOrigin: null,
		draftText: {},
		draftVersions: {},
		active: null,
	});
});
afterEach(async () => {
	await act(() => root?.unmount());
	document.body.innerHTML = "";
});
test("returning to a Queue-opened review must not bypass delayed publication", async () => {
	direct = 0;
	prepared = 0;
	useTabStore.getState().activateReviewWorkspace("workspace", "/tmp/fixture", ctx);
	useReviewModeStore
		.getState()
		.setQueueOrigin({ id: "queue-a", revision: 2, workspaceId: "workspace" });
	useTabStore.getState().setSidebarSegment("queue");
	useTabStore.getState().setSidebarSegment("prs");
	await mount(
		<SubmitReviewPopover
			prCtx={ctx}
			headSha="head"
			draftId={null}
			acceptedThreads={[]}
			pendingCount={0}
			onClose={() => {}}
			onSubmitted={() => {}}
		/>
	);
	await click("Approve");
	await click("Submit review");
	console.log("ORIGIN_RETURN_PUBLICATION", JSON.stringify({ direct, prepared }));
	expect(direct).toBe(0);
	expect(prepared).toBe(1);
});
test("late reply completion cannot erase another queue origin draft", async () => {
	const thread = {
		id: "thread-1",
		isAIDraft: false as const,
		isResolved: false,
		path: "a.ts",
		line: 1,
		diffSide: "RIGHT" as const,
		comments: [
			{
				id: "comment-1",
				body: "Feedback",
				author: "Reviewer",
				authorAvatarUrl: "",
				createdAt: "2026-11-22T00:00:00Z",
			},
		],
	};
	useReviewModeStore.getState().open("workspace", ctx);
	useReviewModeStore
		.getState()
		.setQueueOrigin({ id: "queue-a", revision: 2, workspaceId: "workspace" });
	useReviewModeStore.getState().setDraftText("queue-a:thread-1", "Original reply");
	let resolve!: () => void;
	let sends = 0;
	await mount(
		<ThreadCard
			thread={thread}
			variant="full"
			callbacks={{
				onReply: async () => {
					sends++;
					await new Promise<void>((r) => {
						resolve = r;
					});
				},
			}}
		/>
	);
	await click("Reply");
	await click("Reply", true);
	expect(sends).toBe(1);
	await act(() => root.unmount());
	useReviewModeStore
		.getState()
		.setQueueOrigin({ id: "queue-b", revision: 3, workspaceId: "workspace" });
	useReviewModeStore.getState().setDraftText("queue-b:thread-1", "New account draft");
	await act(async () => {
		resolve();
		await Promise.resolve();
	});
	console.log("LATE_REPLY_DRAFT", JSON.stringify(useReviewModeStore.getState().draftText));
	expect(useReviewModeStore.getState().draftText["queue-b:thread-1"]).toBe("New account draft");
});

const exampleThread = {
	id: "thread-1",
	isAIDraft: false as const,
	isResolved: false,
	path: "a.ts",
	line: 1,
	diffSide: "RIGHT" as const,
	comments: [
		{
			id: "comment-1",
			body: "Feedback",
			author: "Reviewer",
			authorAvatarUrl: "",
			createdAt: "2026-11-22T00:00:00Z",
		},
	],
};
function queueOrigin(id = "queue-a", revision = 2) {
	useReviewModeStore.getState().open("workspace", ctx);
	useReviewModeStore.getState().setQueueOrigin({ id, revision, workspaceId: "workspace" });
}

test("review bindings survive other workspaces and providers without leaking", () => {
	queueOrigin();
	const store = useReviewModeStore.getState();
	store.open("another", { ...ctx, number: 9 });
	expect(useReviewModeStore.getState().queueOrigin).toBeNull();
	store.setQueueOrigin({ id: "queue-b", revision: 3, workspaceId: "another" });
	store.open("workspace", { ...ctx, provider: "bitbucket" });
	expect(useReviewModeStore.getState().queueOrigin).toBeNull();
	store.open("workspace", ctx);
	expect(useReviewModeStore.getState().queueOrigin?.id).toBe("queue-a");
	store.close();
	store.open("workspace", ctx);
	expect(useReviewModeStore.getState().queueOrigin).toBeNull();
	store.open("another", { ...ctx, number: 9 });
	expect(useReviewModeStore.getState().queueOrigin?.id).toBe("queue-b");
});

test("existing session snapshot restores Queue origin and summary draft before opening review", async () => {
	const { collectSessionSnapshot } = await import("../src/renderer/session-snapshot");
	useTabStore.getState().activateReviewWorkspace("workspace", "/tmp/fixture", ctx);
	queueOrigin();
	useReviewModeStore.getState().setDraftText("queue-a:review", "Saved summary");
	const snapshot = collectSessionSnapshot();
	useReviewModeStore.setState({
		active: null,
		queueOrigin: null,
		queueOrigins: {},
		draftText: {},
		draftVersions: {},
	});
	useTabStore.getState().hydrate([], null, "workspace", "/tmp/fixture", snapshot.state);
	expect(useReviewModeStore.getState().queueOrigin?.id).toBe("queue-a");
	await mount(
		<SubmitReviewPopover
			prCtx={ctx}
			headSha="head"
			draftId={null}
			acceptedThreads={[]}
			pendingCount={0}
			onClose={() => {}}
			onSubmitted={() => {}}
		/>
	);
	expect(document.querySelector("textarea")?.value).toBe("Saved summary");
	await act(() => useTabStore.getState().cleanupWorkspace("workspace"));
	expect(Object.keys(useReviewModeStore.getState().queueOrigins)).toHaveLength(0);
});

test("late reply cannot close or clear a newer origin's visible composer", async () => {
	queueOrigin();
	useReviewModeStore.getState().setDraftText("queue-a:thread-1", "Original reply");
	let resolve!: () => void;
	await mount(
		<ThreadCard
			thread={exampleThread}
			variant="full"
			callbacks={{
				onReply: () =>
					new Promise<void>((r) => {
						resolve = r;
					}),
			}}
		/>
	);
	await click("Reply");
	await click("Reply", true);
	await act(() => {
		useReviewModeStore.getState().setDraftText("queue-b:thread-1", "New visible reply");
		useReviewModeStore
			.getState()
			.setQueueOrigin({ id: "queue-b", revision: 3, workspaceId: "workspace" });
	});
	expect(document.querySelector("textarea")?.value).toBe("New visible reply");
	await act(async () => {
		resolve();
		await Promise.resolve();
	});
	expect(document.querySelector("textarea")?.value).toBe("New visible reply");
	expect(useReviewModeStore.getState().draftText["queue-b:thread-1"]).toBe("New visible reply");
});

test("reopening and retyping an identical reply is not erased by the previous operation", async () => {
	queueOrigin();
	useReviewModeStore.getState().setDraftText("queue-a:thread-1", "Same text");
	let resolve!: () => void;
	await mount(
		<ThreadCard
			thread={exampleThread}
			variant="full"
			callbacks={{
				onReply: () =>
					new Promise<void>((r) => {
						resolve = r;
					}),
			}}
		/>
	);
	await click("Reply");
	await click("Reply", true);
	await click("Cancel");
	useReviewModeStore.getState().setDraftText("queue-a:thread-1", "Same text");
	await click("Reply");
	await act(async () => {
		resolve();
		await Promise.resolve();
	});
	expect(document.querySelector("textarea")?.value).toBe("Same text");
	expect(useReviewModeStore.getState().draftText["queue-a:thread-1"]).toBe("Same text");
});

test("late summary publication cannot close a new review or clear its draft", async () => {
	queueOrigin();
	useReviewModeStore.getState().setDraftText("queue-a:review", "Old summary");
	dispatchWait = 0;
	let resolve!: (value: typeof success) => void;
	deferredDispatch = () =>
		new Promise((r) => {
			resolve = r;
		});
	let submitted = 0;
	await mount(
		<SubmitReviewPopover
			prCtx={ctx}
			headSha="head"
			draftId={null}
			acceptedThreads={[]}
			pendingCount={0}
			onClose={() => {}}
			onSubmitted={() => {
				submitted++;
			}}
		/>
	);
	await click("Submit review", true);
	await act(() => new Promise((r) => setTimeout(r, 25)));
	await act(() => {
		useReviewModeStore.getState().setDraftText("queue-b:review", "New summary");
		useReviewModeStore
			.getState()
			.setQueueOrigin({ id: "queue-b", revision: 3, workspaceId: "workspace" });
	});
	await act(async () => {
		resolve(success);
		await Promise.resolve();
	});
	expect(submitted).toBe(0);
	expect(document.querySelector("textarea")?.value).toBe("New summary");
	expect(useReviewModeStore.getState().draftText["queue-b:review"]).toBe("New summary");
});
