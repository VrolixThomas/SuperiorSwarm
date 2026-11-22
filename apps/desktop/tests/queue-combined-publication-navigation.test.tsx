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
	Event: browser.Event,
	IS_REACT_ACT_ENVIRONMENT: true,
}))
	Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
let prepares = 0;
let dispatches = 0;
let cancels = 0;
let wait = 5000;
let release: ((value: { status: string; notBefore: number }) => void) | undefined;
let defer = false;
mock.module("../src/renderer/trpc/client", () => ({
	trpcVanilla: {
		activityQueue: {
			prPublicationPrepare: {
				mutate: async () => {
					prepares++;
					if (defer)
						return await new Promise((resolve) => {
							release = resolve;
						});
					return { status: "pending", notBefore: Date.now() + wait };
				},
			},
			prPublicationCancel: {
				mutate: async () => {
					cancels++;
					return { status: "cancelled" };
				},
			},
			prPublicationDispatch: {
				mutate: async () => {
					dispatches++;
					return { status: "submitted", outcome: { success: true } };
				},
			},
		},
	},
}));
const { createRoot } = await import("react-dom/client");
const { useTabStore } = await import("../src/renderer/stores/tab-store");
const { usePaneStore } = await import("../src/renderer/stores/pane-store");
const { useReviewModeStore } = await import("../src/renderer/stores/review-mode-store");
const { useQueuePRPublication } = await import("../src/renderer/hooks/useQueuePRPublication");
const prCtx = {
	provider: "github" as const,
	owner: "owner",
	repo: "repo",
	number: 7,
	title: "PR",
	sourceBranch: "feature",
	targetBranch: "main",
	repoPath: "/tmp",
};
let root: Root;
let error = "";
function Probe() {
	const action = useQueuePRPublication(prCtx, "head");
	return (
		<>
			{action.notice}
			<button
				type="button"
				disabled={!action.applicable}
				onClick={() => {
					void action.submit({ kind: "review", verdict: "COMMENT", body: "draft" }).catch((e) => {
						error = String(e);
					});
				}}
			>
				Send
			</button>
		</>
	);
}
async function mount() {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(() => root.render(<Probe />));
}
async function click(label: string) {
	await act(() => {
		const button = [...document.querySelectorAll("button")].find((b) => b.textContent === label);
		if (!button) throw Error(`Missing button ${label}`);
		button.click();
	});
}
beforeEach(() => {
	prepares = 0;
	dispatches = 0;
	cancels = 0;
	wait = 5000;
	defer = false;
	release = undefined;
	error = "";
	useTabStore.setState({
		activeWorkspaceId: null,
		activeWorkspaceCwd: "",
		sidebarSegment: "queue",
		workspaceMetadata: {},
		activeWorkspaceBySegment: { queue: null, repos: null, tickets: null, prs: null, hermes: null },
	});
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	useReviewModeStore.setState({ active: null, queueOrigin: null, queueOrigins: {} });
	useTabStore.getState().activateReviewWorkspace("workspace", "/tmp", prCtx);
	useReviewModeStore
		.getState()
		.setQueueOrigin({ workspaceId: "workspace", id: "queue", revision: 1 });
});
afterEach(async () => {
	await act(() => root?.unmount());
	document.body.innerHTML = "";
});
test("Undo cancels pending publication and retains a readable cancellation result", async () => {
	await mount();
	await click("Send");
	expect(prepares).toBe(1);
	expect(dispatches).toBe(0);
	await click("Undo publication");
	expect(cancels).toBe(1);
	expect(error).toContain("draft is retained");
	expect(dispatches).toBe(0);
});
test("leaving the review view cancels before dispatch", async () => {
	await mount();
	await click("Send");
	await act(() => useReviewModeStore.getState().setView("comments"));
	expect(cancels).toBe(1);
	expect(dispatches).toBe(0);
});
test("unmount before preparation response cancels the late reservation", async () => {
	defer = true;
	await mount();
	await click("Send");
	await act(() => root.unmount());
	await act(async () => {
		release?.({ status: "pending", notBefore: Date.now() });
		await Promise.resolve();
	});
	expect(cancels).toBe(2);
	expect(dispatches).toBe(0);
});
test("elapsed reservation dispatches once despite repeated Send", async () => {
	wait = 0;
	await mount();
	await click("Send");
	await click("Send");
	await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
	expect(prepares).toBe(1);
	expect(dispatches).toBe(1);
});
test("explicit close followed by a new ordinary review removes the prior queue origin", async () => {
	useReviewModeStore.getState().close();
	useReviewModeStore.getState().open("workspace", prCtx);
	await mount();
	expect((document.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
	expect(prepares).toBe(0);
});

test("pending publication cancels through tickets, hook project and chat navigation; return stays guarded", async () => {
	await mount();
	await click("Send");
	await act(() => useTabStore.getState().setSidebarSegment("tickets"));
	expect(cancels).toBe(1);
	expect(dispatches).toBe(0);
	await act(() => useTabStore.getState().setSidebarSegment("repos", { restoreWorkspace: false }));
	await act(() => useTabStore.getState().setActiveWorkspace("chat-workspace", "/tmp/chat"));
	await act(() => useTabStore.getState().setSidebarSegment("queue"));
	await act(() => useTabStore.getState().setSidebarSegment("prs"));
	expect(useTabStore.getState().activeWorkspaceId).toBe("workspace");
	expect(useReviewModeStore.getState().queueOrigin).toEqual({
		id: "queue",
		revision: 1,
		workspaceId: "workspace",
	});
	expect(dispatches).toBe(0);
	wait = 0;
	await click("Send");
	await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
	expect(prepares).toBe(2);
	expect(dispatches).toBe(1);
});
test("late preparation after switching to a chat is cancelled and cannot post on return", async () => {
	defer = true;
	await mount();
	await click("Send");
	await act(() => useTabStore.getState().setActiveWorkspace("chat-workspace", "/tmp/chat"));
	await act(async () => {
		release?.({ status: "pending", notBefore: Date.now() });
		await Promise.resolve();
	});
	await act(() => useTabStore.getState().setSidebarSegment("prs"));
	await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
	expect(dispatches).toBe(0);
	expect(cancels).toBeGreaterThanOrEqual(1);
	expect(useReviewModeStore.getState().queueOrigin?.id).toBe("queue");
});
