import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { WorkspaceQueueItem, WorkspaceQueueListResult } from "../src/shared/activity-queue";
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
const { QueueScreen } = await import("../src/renderer/components/queue/QueueView");
let root: Root | undefined;
afterEach(async () => {
	await act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = "";
});
function row(
	id: string,
	kind: "agent-input" | "agent-ready" = "agent-input",
	revision = 1
): WorkspaceQueueItem {
	return {
		id,
		revision,
		kind,
		title: id,
		subject: id,
		summary: "Waiting for your input",
		why: "Waiting for your input",
		sourceLabel: "Workspace update",
		nextAction: "Open the workspace and respond to the agent.",
		openLabel: "Open workspace to respond",
		detailLabel: "What the agent needs",
		occurredAt: 1000,
		acknowledged: false,
		stale: false,
		reasons: [],
		target: { type: "workspace", workspaceId: id },
		category: "agents",
		situation: kind === "agent-input" ? "agent-input" : "agent-done",
		context: {
			workspaceId: id,
			workspaceName: id,
			projectId: "project",
			projectName: "Project",
			projectTint: 1,
		},
		evidence: ["Ready to continue"],
		clearsWhen: "Clears when the agent continues.",
	};
}
async function mount(initial = [row("one"), row("two", "agent-ready")]) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	let rows = initial;
	let view: "pending" | "later" = "pending";
	let deferred: WorkspaceQueueItem[] = [];
	const calls: { action: string; input: unknown }[] = [];
	let conflict = false;
	let old: WorkspaceQueueItem | undefined;
	const data = (): WorkspaceQueueListResult => ({
		items: view === "later" ? deferred : rows,
		totalPending: rows.length,
		laterCount: deferred.length,
		updatedAt: 0,
		sourceErrors: [],
		agentStatusAvailable: true,
	});
	const draw = () =>
		root?.render(
			<QueueScreen
				data={data()}
				pendingItems={rows}
				view={view}
				setView={(v) => {
					view = v;
					draw();
				}}
				refresh={async () => draw()}
				open={async (item) => {
					calls.push({ action: "open", input: item.id });
				}}
				done={async (input) => {
					calls.push({ action: "done", input });
					if (conflict) {
						rows = rows.map((r) => (r.id === input.id ? { ...r, revision: r.revision + 1 } : r));
						return { status: "conflict" };
					}
					old = rows.find((r) => r.id === input.id);
					rows = rows.filter((r) => r.id !== input.id);
					return { status: "acknowledged" };
				}}
				later={async (input) => {
					calls.push({ action: "later", input });
					deferred = rows.filter((r) => r.id === input.id);
					rows = rows.filter((r) => r.id !== input.id);
					return { status: "snoozed" };
				}}
				bringBack={async (input) => {
					calls.push({ action: "back", input });
					rows = [...rows, ...deferred];
					deferred = [];
					return { status: "restored" };
				}}
				undoDone={async (input) => {
					calls.push({ action: "undo", input });
					if (old) rows = [...rows, old];
					return { status: "restored" };
				}}
			/>
		);
	await act(() => draw());
	return {
		calls,
		conflict: () => {
			conflict = true;
		},
		refresh: async (next: WorkspaceQueueItem[]) => {
			rows = next;
			await act(() => draw());
		},
	};
}
async function key(key: string, target: Element | null = document.activeElement) {
	await act(async () => {
		target?.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function selected() {
	return document
		.querySelector("[data-queue-row][aria-current=true]")
		?.getAttribute("data-queue-row");
}
async function click(text: string) {
	const b = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
	if (!b) throw new Error(`Missing ${text}`);
	await act(async () => {
		b.focus();
		b.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}
test("Open only navigates; Done sends displayed revision and Undo restores it", async () => {
	const f = await mount();
	await key("Enter");
	expect(f.calls).toEqual([{ action: "open", input: "one" }]);
	expect(selected()).toBe("one");
	await key("e");
	expect(f.calls.at(-1)).toEqual({ action: "done", input: { id: "one", revision: 1 } });
	expect(selected()).toBe("two");
	await key("z");
	expect(f.calls.at(-1)).toEqual({ action: "undo", input: { id: "one", revision: 1 } });
	expect(selected()).toBe("one");
});
test("conflict refreshes same item without advancing or opening another", async () => {
	const f = await mount();
	f.conflict();
	await key("e");
	expect(selected()).toBe("one");
	expect(document.body.textContent).toContain("This item changed");
	expect(f.calls).toHaveLength(1);
	await key("Enter");
	expect(f.calls.at(-1)).toEqual({ action: "open", input: "one" });
});
test("Later then Bring back use exact revisions and keyboard options", async () => {
	const f = await mount();
	await key("h");
	await key("1");
	expect(f.calls.at(-1)).toEqual({
		action: "later",
		input: { id: "one", revision: 1, until: undefined, untilChange: true },
	});
	expect(selected()).toBe("two");
	await click("Later 1");
	expect(selected()).toBe("one");
	await key("b");
	expect(f.calls.at(-1)).toEqual({ action: "back", input: { id: "one", revision: 1 } });
});
test("selection survives refresh and typing never runs quick actions", async () => {
	const f = await mount();
	await key("ArrowDown");
	expect(selected()).toBe("two");
	await f.refresh([row("new"), row("one"), row("two", "agent-ready", 2)]);
	expect(selected()).toBe("two");
	const input = document.createElement("input");
	document.querySelector("main")?.append(input);
	await key("e", input);
	expect(f.calls).toHaveLength(0);
});
test("new revision closes the Later menu instead of acting on unseen activity", async () => {
	const f = await mount();
	await key("h");
	expect(document.querySelector("dialog")).not.toBeNull();
	await f.refresh([row("one", "agent-input", 2)]);
	expect(document.querySelector("dialog")).toBeNull();
	await key("1");
	expect(f.calls).toHaveLength(0);
});

test("loading, empty and fetch errors offer honest recovery states", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const props = {
		view: "pending" as const,
		setView: () => {},
		refresh: async () => {},
		open: async () => {},
		done: async () => ({ status: "acknowledged" }),
		later: async () => ({ status: "snoozed" }),
		bringBack: async () => ({ status: "restored" }),
		undoDone: async () => ({ status: "restored" }),
	};
	await act(() => root?.render(<QueueScreen {...props} loading />));
	expect(document.body.textContent).toContain("Loading workspaces");
	await act(() =>
		root?.render(
			<QueueScreen
				{...props}
				data={{
					items: [],
					totalPending: 0,
					laterCount: 0,
					updatedAt: null,
					sourceErrors: [],
					agentStatusAvailable: true,
				}}
			/>
		)
	);
	expect(document.body.textContent).toContain("Nothing needs you.");
	await act(() => root?.render(<QueueScreen {...props} error="Connection failed" />));
	expect(document.body.textContent).toContain("Queue unavailable");
	expect(document.body.textContent).toContain("Connection failed");
	expect(document.querySelector('[aria-label="Refresh queue"]')).not.toBeNull();
});
test("unavailable permission items remain readable but cannot be handled", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const calls: string[] = [];
	const item = { ...row("permission"), situation: "agent-permission" as const, stale: true };
	await act(() =>
		root?.render(
			<QueueScreen
				data={{
					items: [item],
					totalPending: 1,
					laterCount: 0,
					updatedAt: 0,
					sourceErrors: [
						{ sourceId: item.id, error: "Workspace status could not be refreshed", observedAt: 0 },
					],
					agentStatusAvailable: false,
				}}
				view="pending"
				setView={() => {}}
				refresh={async () => {}}
				open={async () => {
					calls.push("open");
				}}
				done={async () => {
					calls.push("done");
					return { status: "acknowledged" };
				}}
				later={async () => ({ status: "snoozed" })}
				bringBack={async () => ({ status: "restored" })}
				undoDone={async () => ({ status: "restored" })}
			/>
		)
	);
	expect(document.body.textContent).toContain("Current agent status is unavailable");
	expect(document.querySelector("details")?.open).toBe(false);
	await key("e");
	expect(calls).toHaveLength(0);
	await key("Enter");
	expect(calls).toEqual(["open"]);
	expect(
		[...document.querySelectorAll("button")].some((b) =>
			/Allow|Deny|Approve/.test(b.textContent ?? "")
		)
	).toBe(false);
});

test("keyboard focus follows the next row after Done", async () => {
	const f = await mount();
	await key("ArrowDown");
	expect(document.activeElement?.getAttribute("data-queue-row")).toBe("two");
	await key("e");
	expect(document.activeElement?.getAttribute("data-queue-row")).toBe("one");
	await key("e");
	expect(f.calls.filter((c) => c.action === "done")).toHaveLength(2);
	expect(document.activeElement?.tagName).toBe("MAIN");
	await key("z");
	expect(selected()).toBe("one");
});
test("Later keeps category counts tied to pending items", async () => {
	await mount();
	await key("h");
	await key("1");
	await click("Later 1");
	const tabs = [...document.querySelectorAll('[role="tab"]')].map((el) =>
		el.textContent?.replace(/\s/g, "")
	);
	expect(tabs).toContain("Toreview1");
	expect(tabs).not.toContain("Needsinput1");
});

test("Later does not offer an Undo receipt for a different previously completed item", async () => {
	const f = await mount();
	await key("e");
	await key("h");
	await key("1");
	expect(document.body.textContent).toContain("Moved to Later");
	expect(
		[...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Undo"))
	).toBe(false);
	await key("z");
	expect(f.calls.some((c) => c.action === "undo")).toBe(false);
});

test("selected item keeps its source and next action visible", async () => {
	const item = row("queue-chat", "agent-ready");
	item.sourceLabel = "Codex chat";
	item.nextAction = "Read the latest reply, then continue or mark this item Done.";
	item.openLabel = "Open chat to read reply";
	item.evidence = [];
	item.missingContext = "The reply text is not included in this notification.";
	item.clearsWhen =
		"Done removes this item from the queue. It does not send a reply or finish the task.";
	await mount([item]);
	expect(document.querySelector("[data-queue-row]")?.textContent).toContain("Codex chat");
	const panel = document.querySelector('[aria-label="Queue item details"]');
	expect(panel?.textContent).toContain(item.nextAction);
	expect(panel?.textContent).toContain(item.missingContext);
	expect(panel?.textContent).toContain(item.clearsWhen);
	expect(panel?.querySelector("button")?.textContent).toContain("Open chat to read reply");
});
