import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { focusQueueDestination } from "../src/renderer/lib/activity-queue-navigation";
import { useActivityQueueStore } from "../src/renderer/stores/activity-queue-store";
import { useTabStore } from "../src/renderer/stores/tab-store";
import { trpc, trpcVanilla } from "../src/renderer/trpc/client";
import type { ActivityQueueItem, ActivityQueueListResult } from "../src/shared/activity-queue";

const browser = new Window({ url: "http://localhost" });
let notify: (() => void) | undefined;
let daemonStatus: ((connected: boolean) => void) | undefined;
const calls: { path: string; input: unknown }[] = [];
let projection: ActivityQueueListResult = {
	items: [],
	totalPending: 0,
	updatedAt: 0,
	sourceErrors: [],
};
let ackStatus = "acknowledged";
Object.assign(browser, {
	electron: {
		daemon: {
			onStatus: (callback: (connected: boolean) => void) => {
				daemonStatus = callback;
				return () => {
					daemonStatus = undefined;
				};
			},
		},
		agentAlert: {
			onAlert: (callback: () => void) => {
				notify = callback;
				return () => {
					notify = undefined;
				};
			},
		},
		trpc: {
			request: async (request: { path: string; input: unknown }) => {
				calls.push(request);
				if (request.path === "activityQueue.list") return { result: { data: projection } };
				if (request.path === "activityQueue.acknowledge")
					return { result: { data: { status: ackStatus, item: projection.items[0] } } };
				throw new Error(`Unexpected API ${request.path}`);
			},
		},
	},
});
for (const [key, value] of Object.entries({
	window: browser,
	document: browser.document,
	navigator: browser.navigator,
	HTMLElement: browser.HTMLElement,
	Event: browser.Event,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
	cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
}))
	Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { createRoot } = await import("react-dom/client");
const { ActivityQueueButton } = await import("../src/renderer/components/ActivityQueueButton");
let root: Root | undefined;
let client: QueryClient;
afterEach(async () => {
	if (root) await act(() => root?.unmount());
	root = undefined;
	client?.clear();
	document.body.innerHTML = "";
	useActivityQueueStore.setState({ open: false });
	calls.length = 0;
	ackStatus = "acknowledged";
});
function row(
	provider: string,
	revision: number,
	kind: ActivityQueueItem["kind"]
): ActivityQueueItem {
	return {
		id: provider,
		revision,
		kind,
		title: `${provider} turn ${revision}`,
		summary: "Authoritative source state",
		occurredAt: revision * 1000,
		reasons: [{ code: kind, label: "New occurrence" }],
		target: { type: "unavailable", reason: "Fixture has no terminal" },
		acknowledged: false,
		stale: false,
	};
}
async function flush() {
	await act(async () => {
		await new Promise((r) => setTimeout(r, 25));
	});
}
async function mount(compact = false) {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(() =>
		root?.render(
			<trpc.Provider client={trpcVanilla} queryClient={client}>
				<QueryClientProvider client={client}>
					<ActivityQueueButton compact={compact} />
				</QueryClientProvider>
			</trpc.Provider>
		)
	);
	await flush();
}
function trigger() {
	const button = document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
	if (!button) throw new Error("Missing Queue trigger");
	return button;
}
async function publish(items: ActivityQueueItem[]) {
	projection = {
		items,
		totalPending: items.filter((i) => !i.acknowledged).length,
		updatedAt: Date.now(),
		sourceErrors: [],
	};
	await act(() => notify?.());
	await flush();
}

test("Codex and Claude repeated ready/input occurrences converge without transient workspace fallback", async () => {
	projection = { items: [], totalPending: 0, updatedAt: 0, sourceErrors: [] };
	useTabStore.setState({ activeWorkspaceId: "unrelated", sidebarSegment: "tickets" });
	await mount();
	await act(() => trigger().click());
	for (const provider of ["codex", "claude"]) {
		await publish([row(provider, 1, "agent-ready")]);
		expect(document.body.textContent).toContain(`${provider} turn 1`);
		await publish([]);
		expect(document.body.textContent).toContain("All caught up");
		await publish([row(provider, 2, "agent-ready")]);
		expect(document.body.textContent).toContain(`${provider} turn 2`);
		await publish([]);
		await publish([row(provider, 3, "agent-input")]);
		expect(document.body.textContent).toContain(`${provider} turn 3`);
		await publish([row(provider, 4, "agent-input")]);
		expect(document.body.textContent).toContain(`${provider} turn 4`);
	}
	expect(useTabStore.getState().activeWorkspaceId).toBe("unrelated");
	expect(useTabStore.getState().sidebarSegment).toBe("tickets");
	expect(calls.every((c) => c.path === "activityQueue.list")).toBe(true);
});

test("collapsed entrypoint opens labelled panel; Escape returns focus without navigation or acknowledgment", async () => {
	projection = {
		items: [row("codex", 1, "agent-ready")],
		totalPending: 1,
		updatedAt: 1,
		sourceErrors: [],
	};
	await mount(true);
	expect(trigger().textContent).toBe("Queue1");
	trigger().focus();
	await act(() => trigger().click());
	const dialog = document.querySelector("dialog");
	if (!dialog) throw new Error("Missing dialog");
	expect(document.activeElement).toBe(dialog);
	await act(() => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
	await flush();
	expect(document.querySelector("dialog")).toBeNull();
	expect(document.activeElement).toBe(trigger());
	expect(calls.every((c) => c.path === "activityQueue.list")).toBe(true);
});

test("Handled calls the real mutation with displayed revision and keeps concurrent conflict visible", async () => {
	projection = {
		items: [row("codex", 3, "agent-input")],
		totalPending: 1,
		updatedAt: 1,
		sourceErrors: [],
	};
	await mount();
	await act(() => trigger().click());
	// Backend has advanced but the displayed row still represents revision 3.
	projection = { ...projection, items: [row("codex", 4, "agent-input")] };
	ackStatus = "conflict";
	const handle = document.querySelector<HTMLButtonElement>('button[aria-label^="Mark "]');
	if (!handle) throw new Error("Missing Handled button");
	await act(() => handle.click());
	await flush();
	expect(
		calls
			.filter((c) => c.path === "activityQueue.acknowledge")
			.map(({ path, input }) => ({ path, input }))
	).toEqual([{ path: "activityQueue.acknowledge", input: { id: "codex", revision: 3 } }]);
	expect(document.body.textContent).toContain("New activity arrived");
	expect(document.body.textContent).toContain("codex turn 4");
	expect(trigger().getAttribute("aria-label")).toBe("Queue 1");
});

test("remount and reconnect invalidation recover missed source changes", async () => {
	projection = {
		items: [row("codex", 1, "agent-ready")],
		totalPending: 1,
		updatedAt: 1,
		sourceErrors: [],
	};
	await mount();
	await act(() => root?.unmount());
	root = undefined;
	client.clear();
	projection = { ...projection, items: [row("codex", 2, "agent-input")] };
	await mount();
	await act(() => trigger().click());
	expect(document.body.textContent).toContain("codex turn 2");
	projection = { ...projection, items: [row("codex", 3, "agent-ready")] };
	await act(() => daemonStatus?.(true));
	await flush();
	expect(document.body.textContent).toContain("codex turn 3");
});

test("destination focus selects the exact terminal after the panel closes", async () => {
	await mount();
	const workspace = document.createElement("div");
	workspace.setAttribute("data-queue-workspace", "target");
	workspace.tabIndex = -1;
	for (const id of ["first", "second"]) {
		const terminal = document.createElement("div");
		terminal.setAttribute("data-terminal-id", id);
		const input = document.createElement("textarea");
		input.className = "xterm-helper-textarea";
		terminal.append(input);
		workspace.append(terminal);
	}
	document.body.append(workspace);
	focusQueueDestination({ workspaceId: "target", terminalId: "second" });
	await flush();
	await flush();
	expect(document.activeElement).toBe(
		document.querySelector('[data-terminal-id="second"] textarea')
	);
});

test("Queue command opens the panel without selecting a workspace or segment", async () => {
	Object.defineProperty(globalThis, "matchMedia", {
		value: browser.matchMedia.bind(browser),
		configurable: true,
	});
	const { registerCoreActions } = await import("../src/renderer/actions/core-actions");
	const { useActionStore } = await import("../src/renderer/stores/action-store");
	projection = { items: [], totalPending: 0, updatedAt: 0, sourceErrors: [] };
	useTabStore.setState({ activeWorkspaceId: "ongoing", sidebarSegment: "hermes" });
	await mount();
	registerCoreActions();
	await act(() => useActionStore.getState().execute("nav.queue"));
	await flush();
	expect(document.querySelector("dialog")?.open).toBe(true);
	expect(useTabStore.getState().activeWorkspaceId).toBe("ongoing");
	expect(useTabStore.getState().sidebarSegment).toBe("hermes");
});
