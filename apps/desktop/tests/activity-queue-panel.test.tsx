import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { QUEUE_GROUPS, uniqueQueueItems } from "../src/renderer/lib/activity-queue-view";
import type { ActivityQueueItem, ActivityQueueListResult } from "../src/shared/activity-queue";

const browser = new Window({ url: "http://localhost" });
for (const [key, value] of Object.entries({
	window: browser,
	document: browser.document,
	navigator: browser.navigator,
	HTMLElement: browser.HTMLElement,
	Event: browser.Event,
	KeyboardEvent: browser.KeyboardEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
}))
	Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { createRoot } = await import("react-dom/client");
const { ActivityQueuePanel } = await import("../src/renderer/components/ActivityQueuePanel");
let root: Root | undefined;
afterEach(async () => {
	if (root) await act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = "";
});
function item(overrides: Partial<ActivityQueueItem> = {}): ActivityQueueItem {
	return {
		id: "a",
		revision: 3,
		kind: "agent-input",
		title: "Waiting for input",
		summary: "Choose a deployment target",
		projectId: "p1",
		projectName: "Project One",
		occurredAt: 1000,
		reasons: [{ code: "question", label: "Unanswered question" }],
		target: { type: "workspace", workspaceId: "w1" },
		acknowledged: false,
		stale: false,
		...overrides,
	};
}
function data(
	items: ActivityQueueItem[],
	totalPending = items.filter((i) => !i.acknowledged).length
): ActivityQueueListResult {
	return { items, totalPending, updatedAt: 2000, sourceErrors: [] };
}
async function mount(overrides: Partial<React.ComponentProps<typeof ActivityQueuePanel>> = {}) {
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	const props = {
		data: data([item()]),
		loading: false,
		onRefresh: mock(() => {}),
		onClose: mock(() => {}),
		onOpen: mock(async () => {}),
		onHandled: mock(async () => {}),
		...overrides,
	};
	await act(() => root?.render(<ActivityQueuePanel {...props} />));
	return props;
}
function button(label: string) {
	const result = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
		(b) => b.getAttribute("aria-label") === label || b.textContent === label
	);
	if (!result) throw new Error(`Missing button ${label}`);
	return result;
}
async function click(label: string) {
	await act(async () => button(label).click());
}

describe("Queue presentation and actions", () => {
	test("orders priority, meaningful recency and stable IDs; keeps greatest revision once", () => {
		const rows = [
			item({ id: "ready", kind: "agent-ready", occurredAt: 9000 }),
			item({ id: "old", occurredAt: 500 }),
			item({ id: "pr", kind: "pr-review" }),
			item({ id: "update", kind: "pr-update" }),
			item({ id: "a", revision: 1 }),
			item({ id: "b" }),
			item({ id: "a", revision: 4 }),
		];
		expect(uniqueQueueItems(rows).map((i) => i.id)).toEqual([
			"a",
			"b",
			"old",
			"pr",
			"update",
			"ready",
		]);
		expect(uniqueQueueItems(rows)[0]?.revision).toBe(4);
	});
	test("Open never acknowledges; Handled sends the displayed occurrence separately", async () => {
		const props = await mount();
		await click("Open Waiting for input");
		expect(props.onOpen).toHaveBeenCalledTimes(1);
		expect(props.onHandled).not.toHaveBeenCalled();
		await click("Mark Waiting for input handled");
		expect(props.onHandled).toHaveBeenCalledWith(expect.objectContaining({ id: "a", revision: 3 }));
	});
	test("rapid Open clicks are guarded and failures retain the row with an error", async () => {
		let reject!: (reason: Error) => void;
		const onOpen = mock(
			() =>
				new Promise<void>((_, r) => {
					reject = r;
				})
		);
		await mount({ onOpen });
		await act(() => {
			button("Open Waiting for input").click();
			button("Open Waiting for input").click();
		});
		expect(onOpen).toHaveBeenCalledTimes(1);
		await act(async () => reject(new Error("Terminal unavailable")));
		expect(document.querySelector('[role="alert"]')?.textContent).toBe("Terminal unavailable");
		expect(button("Open Waiting for input").disabled).toBe(false);
	});
	test("category/project filters leave global pending count unchanged; handled rows opt in", async () => {
		await mount({
			data: data(
				[
					item(),
					item({
						id: "pr",
						kind: "pr-review",
						projectId: "p2",
						projectName: "Project Two",
						title: "Review PR",
					}),
					item({ id: "handled", title: "Already handled", acknowledged: true }),
				],
				2
			),
		});
		expect(document.body.textContent).not.toContain("Already handled");
		const selects = document.querySelectorAll("select");
		await act(() => {
			const category = selects[0];
			if (!category) throw new Error("Missing category filter");
			category.value = "pr-review";
			category.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(document.body.textContent).toContain(
			"1 pending in this view · 2 pending across all projects"
		);
		expect(document.body.textContent).not.toContain("Waiting for input");
		await act(() => {
			const project = selects[1];
			if (!project) throw new Error("Missing project filter");
			project.value = "p1";
			project.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(document.body.textContent).toContain("No items match these filters.");
		await act(() => {
			const category = selects[0];
			if (!category) throw new Error("Missing category filter");
			category.value = "all";
			category.dispatchEvent(new Event("change", { bubbles: true }));
			document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
		});
		expect(document.body.textContent).toContain("Already handled");
	});
	test("shows every PR reason on one row and keeps stale/error states distinct", async () => {
		await mount({
			data: {
				...data([
					item({
						id: "pr",
						kind: "pr-review",
						stale: true,
						reasons: [
							{ code: "review", label: "Review requested" },
							{ code: "head", label: "New commits" },
						],
					}),
				]),
				sourceErrors: [{ sourceId: "pr", error: "Offline", observedAt: 1000 }],
			},
			error: "Disconnected",
		});
		expect(document.querySelectorAll('button[aria-label^="Open "]')).toHaveLength(1);
		for (const text of [
			"Review requested",
			"New commits",
			"Stale",
			"Offline",
			"Showing the last available queue",
		])
			expect(document.body.textContent).toContain(text);
	});
	test("many stale sources produce a collapsed, grouped summary for pending rows only", async () => {
		const rows = Array.from({ length: 100 }, (_, i) => item({ id: `pr-${i}`, title: `PR ${i}` }));
		await mount({
			data: {
				...data(rows),
				sourceErrors: [
					...rows.map((row) => ({
						sourceId: row.id,
						error: "PR status not confirmed",
						observedAt: 1,
					})),
					{ sourceId: "no-item", error: "Historical noise", observedAt: 1 },
				],
			},
		});
		const details = document.querySelector("details");
		expect(details?.open).toBe(false);
		expect(details?.querySelector("summary")?.textContent).toContain(
			"100 pending items could not be refreshed"
		);
		expect(details?.querySelectorAll("li")).toHaveLength(1);
		expect(details?.textContent).toContain("PR status not confirmed (100)");
		expect(document.body.textContent).not.toContain("Historical noise");
	});
	test("unknown agent inventory does not claim the queue is empty", async () => {
		await mount({ data: { ...data([]), agentStatusAvailable: false } });
		expect(document.body.textContent).toContain("Agent status is unavailable");
		expect(document.body.textContent).not.toContain("All caught up");
	});
	test("loading, empty and initial error have different messages", async () => {
		const props = await mount({ data: undefined, loading: true });
		expect(document.body.textContent).toContain("Loading queue");
		await act(() =>
			root?.render(<ActivityQueuePanel {...props} data={data([])} loading={false} />)
		);
		expect(document.body.textContent).toContain("All caught up");
		await act(() =>
			root?.render(
				<ActivityQueuePanel {...props} data={undefined} loading={false} error="Offline" />
			)
		);
		expect(document.body.textContent).toContain("Queue could not refresh");
		expect(document.body.textContent).not.toContain("All caught up");
	});
	test("panel and filters have labels; native Escape cancellation invokes Close", async () => {
		const props = await mount();
		const dialog = document.querySelector("dialog");
		if (!dialog) throw new Error("Missing dialog");
		expect(dialog.open).toBe(true);
		expect(document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
			"Queue 1"
		);
		for (const select of document.querySelectorAll("select"))
			expect(document.querySelector(`label[for="${select.id}"]`)).not.toBeNull();
		await act(() => dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
		expect(props.onClose).toHaveBeenCalledTimes(1);
		expect(QUEUE_GROUPS.map((g) => g.label)).toEqual([
			"Needs input",
			"PR review needed",
			"PR updated",
			"Ready agents",
		]);
	});
	test("conflict keeps latest row pending and explains why handling failed", async () => {
		const props = await mount({
			onHandled: async () => {
				throw new Error("New activity arrived. The newer occurrence remains pending.");
			},
		});
		await click("Mark Waiting for input handled");
		await act(() =>
			root?.render(<ActivityQueuePanel {...props} data={data([item({ revision: 4 })])} />)
		);
		expect(document.body.textContent).toContain("New activity arrived");
		expect(button("Mark Waiting for input handled").disabled).toBe(false);
	});
});

test("a project disappearing on refresh preserves an explicit empty filter", async () => {
	const props = await mount();
	const project = document.querySelectorAll("select")[1];
	if (!project) throw new Error("Missing project filter");
	await act(() => {
		project.value = "p1";
		project.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await act(() => root?.render(<ActivityQueuePanel {...props} data={data([])} />));
	expect(project.value).toBe("p1");
	expect(project.selectedOptions[0]?.textContent).toBe("Selected project (no items)");
	await act(() => {
		project.value = "all";
		project.dispatchEvent(new Event("change", { bubbles: true }));
	});
	expect(project.value).toBe("all");
});

test("Tab and Shift+Tab wrap inside the modal including its initial panel focus", async () => {
	await mount();
	const dialog = document.querySelector("dialog");
	if (!dialog) throw new Error("Missing dialog");
	const controls = dialog.querySelectorAll<HTMLElement>("button:not([disabled]),select,input");
	const first = controls[0];
	const last = controls[controls.length - 1];
	if (!first || !last) throw new Error("Missing dialog controls");
	dialog.focus();
	await act(() =>
		dialog.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })
		)
	);
	expect(document.activeElement).toBe(last);
	await act(() =>
		last?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
		)
	);
	expect(document.activeElement).toBe(first);
	await act(() =>
		first?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })
		)
	);
	expect(document.activeElement).toBe(last);
});
