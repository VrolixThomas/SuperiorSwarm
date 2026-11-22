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
mock.module("../src/renderer/stores/tab-store", () => ({
	useTabStore: (select: (state: unknown) => unknown) =>
		select({ sidebarSegment: "prs", activeWorkspaceId: "workspace" }),
}));
mock.module("../src/renderer/stores/pane-store", () => ({
	usePaneStore: (select: (state: unknown) => unknown) =>
		select({ getFocusedPane: () => ({ activeTabId: "review" }) }),
}));
const { createRoot } = await import("react-dom/client");
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
	useReviewModeStore.getState().open("workspace", prCtx);
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
test("opening an ordinary review removes the prior queue origin", async () => {
	useReviewModeStore.getState().open("workspace", prCtx);
	await mount();
	expect((document.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
	expect(prepares).toBe(0);
});
