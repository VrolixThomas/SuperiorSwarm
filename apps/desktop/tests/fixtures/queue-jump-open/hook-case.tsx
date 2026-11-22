import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { WorkspaceQueueItem } from "../../../src/shared/activity-queue";

// Run this module alone: mocked transport exercises the real hook + real item Open adapter.
const browser = new Window({ url: "http://localhost" });
for (const [key, value] of Object.entries({
	window: browser,
	document: browser.document,
	navigator: browser.navigator,
	HTMLElement: browser.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
}))
	Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const events: string[] = [];
const receipts: unknown[] = [];
let result: "opened" | "uncertain" | "unavailable" = "opened";
const item: WorkspaceQueueItem = {
	id: "permission",
	revision: 4,
	members: [
		{ id: "permission", revision: 4 },
		{ id: "report", revision: 7 },
	],
	kind: "agent-input",
	occurredAt: 1,
	acknowledged: false,
	stale: false,
	title: "Permission",
	subject: "Permission",
	summary: "Permission",
	why: "Permission",
	clearsWhen: "Native prompt",
	sourceLabel: "Provider",
	nextAction: "Open",
	openLabel: "Open",
	detailLabel: "Permission",
	category: "agents",
	situation: "agent-permission",
	evidence: [],
	reasons: [],
	permission: { requestId: "request", outcome: "pending" },
	target: {
		type: "terminal",
		workspaceId: "workspace",
		entity: { kind: "workspace", id: "workspace" },
		terminalId: "terminal",
		provider: "codex",
		providerSessionId: "conversation",
	},
	context: {
		entity: { kind: "workspace", id: "workspace" },
		workspaceId: "workspace",
		workspaceName: "Workspace",
		projectName: "Project",
		projectTint: 1,
	},
};
const query = {
	refetch: async () => ({ isError: false, data: { items: [item], agentStatusAvailable: true } }),
};
mock.module("../../../src/renderer/hooks/useWorkspaceQueue", () => ({
	useWorkspaceQueue: () => query,
}));
mock.module("../../../src/renderer/lib/activity-queue-navigation", () => ({
	openQueueTarget: async (target: unknown) => {
		events.push("navigate");
		receipts.push(target);
		return { workspaceId: "workspace", terminalId: "terminal" };
	},
	focusQueueDestination: () => events.push("focus"),
}));
mock.module("../../../src/renderer/trpc/client", () => ({
	trpcVanilla: {
		activityQueue: {
			workspacePermissionCapability: {
				query: async (input: unknown) => {
					events.push("capability");
					receipts.push(input);
					return {
						capability: "hook-response",
						state: "waiting",
						requestId: "request",
						detail: "Waiting",
					};
				},
			},
			workspacePermissionDecision: {
				mutate: async (input: unknown) => {
					events.push("release");
					receipts.push(input);
					return { status: result, detail: "Release uncertain" };
				},
			},
		},
	},
}));
const { createRoot } = await import("react-dom/client");
const { useQueueNavigation } = await import("../../../src/renderer/hooks/useQueueNavigation");
const { useQueueNavigationStore } = await import(
	"../../../src/renderer/stores/queue-navigation-store"
);
let root: Root | undefined;
function Surface() {
	const nav = useQueueNavigation();
	return (
		<>
			<button type="button" onClick={() => void nav.open(item)}>
				Explicit open
			</button>
			<output>{nav.message}</output>
		</>
	);
}
afterEach(async () => {
	await act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = "";
});
async function mount() {
	events.length = 0;
	receipts.length = 0;
	result = "opened";
	useQueueNavigationStore.setState({ session: null, jumpRequest: 0, peekOpen: false });
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(() => root?.render(<Surface />));
}
test("passive mount/peek never release; Next releases exact group before navigation", async () => {
	await mount();
	await act(() => useQueueNavigationStore.getState().peek());
	expect(events).toEqual([]);
	await act(() => useQueueNavigationStore.getState().next());
	expect(events).toEqual(["capability", "release", "navigate", "focus"]);
	expect(receipts[1]).toEqual({
		id: item.id,
		revision: 4,
		members: item.members,
		requestId: "request",
		action: "open",
	});
	expect(useQueueNavigationStore.getState().session?.item.target).toEqual(item.target);
});
test("Peek/bar explicit Open shares release-before-navigation and uncertain failure does not move", async () => {
	await mount();
	result = "uncertain";
	await act(() => document.querySelector<HTMLButtonElement>("button")?.click());
	expect(events).toEqual(["capability", "release"]);
	expect(useQueueNavigationStore.getState().session).toBeNull();
	expect(document.body.textContent).toContain("Release uncertain");
});

test("a live wait with unavailable release cannot silently navigate", async () => {
	await mount();
	result = "unavailable";
	await act(() => document.querySelector<HTMLButtonElement>("button")?.click());
	expect(events).toEqual(["capability", "release"]);
	expect(useQueueNavigationStore.getState().session).toBeNull();
});
