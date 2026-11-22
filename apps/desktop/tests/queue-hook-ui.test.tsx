import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { ExternalQueueItem } from "../src/shared/activity-queue";
import type { OwnedChatLaunch } from "../src/shared/owned-chat";
import type { QueueHookProjectStatus } from "../src/shared/queue-hooks";

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
const { createRoot } = await import("react-dom/client");
let enabled = true;
let project: QueueHookProjectStatus;
const calls: { method: string; input: unknown }[] = [];
type FixResult = { status: "cancelled" } | { status: "prepared"; launch: OwnedChatLaunch };
let fixResult: FixResult | undefined;
let pendingFix = Promise.resolve();
const mutation = (method: string) => ({
	useMutation: (options?: {
		onSuccess?: (result: FixResult) => void | Promise<void>;
		onError?: () => void;
	}) => ({
		isPending: false,
		mutate: (input: unknown) => {
			calls.push({ method, input });
			if (method === "fix" && fixResult) {
				pendingFix = Promise.resolve(options?.onSuccess?.(fixResult)).catch(() =>
					options?.onError?.()
				);
			}
		},
	}),
});
mock.module("../src/renderer/trpc/client", () => ({
	trpc: {
		useUtils: () => ({ queueHooks: { status: { invalidate: async () => {} } } }),
		queueHooks: {
			status: { useQuery: () => ({ data: { enabled, projects: [project] } }) },
			setEnabled: mutation("enable"),
			trust: mutation("trust"),
			revoke: mutation("revoke"),
			run: mutation("run"),
			fix: mutation("fix"),
			fixTargets: { useQuery: () => ({ data: [{ id: "workspace", name: "Project root" }] }) },
		},
	},
}));
const { ProjectHookSettings } = await import(
	"../src/renderer/components/settings/ProjectHookSettings"
);
const { QueueHookActions } = await import("../src/renderer/components/queue/QueueHookActions");
let root: Root;
beforeEach(() => {
	enabled = true;
	fixResult = undefined;
	pendingFix = Promise.resolve();
	calls.length = 0;
	project = {
		projectId: "project",
		projectName: "Example",
		root: "/reviewed/root",
		hash: "reviewed-hash",
		configText: "hooks: reviewed commands",
		hooks: [],
		trusted: false,
		error: null,
	};
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(() => root.unmount());
	document.body.innerHTML = "";
});
function button(label: string) {
	const found = Array.from(browser.document.querySelectorAll("button")).find(
		(value) => value.textContent?.trim() === label
	);
	if (!found) throw new Error(`Missing button ${label}`);
	return found;
}
test("trust submits the reviewed snapshot even if polling discovers a changed config", async () => {
	await act(() => root.render(<ProjectHookSettings />));
	await act(() => button("Review configuration").click());
	project = {
		...project,
		hash: "unseen-hash",
		configText: "hooks: unseen commands",
		root: "/unseen/root",
	};
	await act(() => root.render(<ProjectHookSettings />));
	expect(document.querySelector("pre")?.textContent).toBe("hooks: reviewed commands");
	await act(() => button("Trust these hooks").click());
	expect(calls).toEqual([
		{ method: "trust", input: { projectId: "project", hash: "reviewed-hash" } },
	]);
});
test("disabled hooks expose opt-in but do not show trust or run controls", async () => {
	enabled = false;
	await act(() => root.render(<ProjectHookSettings />));
	expect(document.body.textContent).toContain("Enable project queue checks");
	expect(document.body.textContent).not.toContain("Trust these hooks");
	expect(document.body.textContent).not.toContain("Run checks now");
	expect(calls).toHaveLength(0);
});
test("Fix shows context and requires explicit click with exact revision and selected target", async () => {
	const item = {
		id: "hook:project:checks:key",
		revision: 4,
		stale: false,
		target: {
			type: "project-hook",
			projectId: "project",
			hookId: "checks",
			key: "key",
			fixPrompt: "Repair the failing check $(without shell evaluation)",
		},
	} as ExternalQueueItem;
	const render = () => root.render(<QueueHookActions item={item} refresh={async () => {}} />);
	await act(render);
	expect(document.body.textContent).toContain(
		item.target.type === "project-hook" ? (item.target.fixPrompt ?? "") : "missing"
	);
	expect(calls).toHaveLength(0);
	await act(() => button("Fix with agent…").click());
	expect(calls).toEqual([
		{ method: "fix", input: { id: item.id, revision: 4, workspaceId: "workspace" } },
	]);
	item.stale = true;
	await act(render);
	expect(button("Fix with agent…").disabled).toBe(true);
});

const preparedLaunch: OwnedChatLaunch = {
	workspaceId: "workspace",
	terminalId: "prepared-hook-terminal",
	cwd: "/project-root",
	title: "Fix synthetic check",
	scriptPath: "/tmp/fixture-hook-launch.sh",
};
const hookItem = {
	id: "hook:project:checks:launch",
	revision: 7,
	stale: false,
	target: {
		type: "project-hook",
		projectId: "project",
		hookId: "checks",
		key: "launch",
		fixPrompt: "Fix the synthetic check",
	},
} as ExternalQueueItem;
function terminalActions(create: () => Promise<unknown>, writes: string[]) {
	Object.defineProperty(browser, "electron", {
		configurable: true,
		value: {
			terminal: {
				create: async (id: string, cwd: string, owner: string) => {
					expect([id, cwd, owner]).toEqual([
						preparedLaunch.terminalId,
						preparedLaunch.cwd,
						preparedLaunch.workspaceId,
					]);
					return create();
				},
				write: async (id: string, text: string) => {
					expect(id).toBe(preparedLaunch.terminalId);
					writes.push(text);
					return true;
				},
			},
		},
	});
}
test("confirmed Fix creates the exact prepared terminal before writing its script once", async () => {
	fixResult = { status: "prepared", launch: preparedLaunch };
	let release: (() => void) | undefined;
	const creation = new Promise<void>((resolve) => {
		release = resolve;
	});
	let creates = 0;
	const writes: string[] = [];
	terminalActions(async () => {
		creates++;
		return creation;
	}, writes);
	await act(() => root.render(<QueueHookActions item={hookItem} refresh={async () => {}} />));
	await act(() => button("Fix with agent…").click());
	expect(creates).toBe(1);
	expect(writes).toEqual([]);
	await act(async () => {
		release?.();
		await pendingFix;
	});
	expect(writes).toHaveLength(1);
	expect(writes[0]).toContain(preparedLaunch.scriptPath);
	expect(writes[0]?.endsWith("\r")).toBe(true);
	const { useTabStore } = await import("../src/renderer/stores/tab-store");
	expect(useTabStore.getState()).toMatchObject({
		activeWorkspaceId: preparedLaunch.workspaceId,
		activeWorkspaceCwd: preparedLaunch.cwd,
		sidebarSegment: "repos",
	});
	expect(document.body.textContent).toContain("Agent started.");
	await act(() => root.render(<QueueHookActions item={hookItem} refresh={async () => {}} />));
	expect(writes).toHaveLength(1);
});
test("cancelled Fix never creates a terminal or sends a script", async () => {
	fixResult = { status: "cancelled" };
	let creates = 0;
	const writes: string[] = [];
	terminalActions(async () => {
		creates++;
	}, writes);
	await act(() => root.render(<QueueHookActions item={hookItem} refresh={async () => {}} />));
	await act(async () => {
		button("Fix with agent…").click();
		await pendingFix;
	});
	expect(creates).toBe(0);
	expect(writes).toEqual([]);
	expect(document.body.textContent).toContain("Launch cancelled.");
});
test("failed exact terminal creation never writes or claims that the agent started", async () => {
	fixResult = { status: "prepared", launch: preparedLaunch };
	const writes: string[] = [];
	terminalActions(async () => {
		throw Error("synthetic create failure");
	}, writes);
	await act(() => root.render(<QueueHookActions item={hookItem} refresh={async () => {}} />));
	await act(async () => {
		button("Fix with agent…").click();
		await pendingFix;
	});
	expect(writes).toEqual([]);
	expect(document.body.textContent).not.toContain("Agent started.");
	expect(document.body.textContent).toContain("launch failed");
});
