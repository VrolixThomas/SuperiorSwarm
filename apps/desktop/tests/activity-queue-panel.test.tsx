import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
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
type Props = React.ComponentProps<typeof ActivityQueuePanel>;
let root: Root | undefined;
afterEach(async () => {
	if (root) await act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = "";
});
function item(id = "a", overrides: Partial<ActivityQueueItem> = {}): ActivityQueueItem {
	return {
		id,
		revision: 3,
		kind: "agent-input",
		title: `Item ${id}`,
		summary: "Choose a deployment target",
		projectId: "p1",
		projectName: "Project One",
		occurredAt: 1000,
		reasons: [{ code: "question", label: "Unanswered question" }],
		target: { type: "workspace", workspaceId: id },
		acknowledged: false,
		stale: false,
		...overrides,
	};
}
function data(
	items: ActivityQueueItem[],
	totalPending = items.filter((row) => !row.acknowledged).length
): ActivityQueueListResult {
	return { items, totalPending, updatedAt: 2000, sourceErrors: [] };
}
async function mount(overrides: Partial<Props> = {}) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const props: Props = {
		data: data([item()]),
		loading: false,
		onRefresh: mock(() => {}),
		onClose: mock(() => {}),
		onOpen: mock(async () => {}),
		onHandled: mock(async () => data([])),
		...overrides,
	};
	await render(props);
	return props;
}
async function render(props: Props) {
	await act(() => root?.render(<ActivityQueuePanel {...props} />));
}
function button(label: string) {
	const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.getAttribute("aria-label") === label || b.textContent === label
	);
	if (!result) throw new Error(`Missing button ${label}`);
	return result;
}
async function click(label: string) {
	await act(async () => button(label).click());
}
const selectedTitle = () =>
	document.querySelector('button[aria-current="true"]')?.getAttribute("aria-label");

test("Open keeps the dock available and never handles; repeated clicks are guarded", async () => {
	let finish!: () => void;
	const props = await mount({
		onOpen: mock(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		),
	});
	await act(() => {
		button("Open Item a").click();
		button("Open Item a").click();
	});
	expect(props.onOpen).toHaveBeenCalledTimes(1);
	await act(() => finish());
	expect(props.onHandled).not.toHaveBeenCalled();
	expect(props.onClose).not.toHaveBeenCalled();
	expect(document.querySelector("aside")).not.toBeNull();
	expect(document.querySelector("dialog")).toBeNull();
});

test("Handle & next confirms the displayed revision then opens the next filtered item", async () => {
	const a = item("a");
	const b = item("b");
	const c = item("c");
	const order: string[] = [];
	const props: Props = await mount({
		data: data([a, b, c]),
		onHandled: mock(async (row) => {
			order.push(`handled:${row.id}:${row.revision}`);
			const next = data([b, c]);
			await render({ ...props, data: next });
			return next;
		}),
		onOpen: mock(async (row) => {
			order.push(`open:${row.id}`);
		}),
	});
	await click("Handle Item a and open next item");
	expect(order).toEqual(["handled:a:3", "open:b"]);
	expect(selectedTitle()).toBe("Open Item b");
	expect(props.onClose).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain("1 of 2");
});

test("failed or stale receipts keep selection and never open a successor", async () => {
	const props = await mount({
		data: data([item("a"), item("b")]),
		onHandled: mock(async () => {
			throw new Error("New activity arrived");
		}),
	});
	await click("Handle Item a and open next item");
	expect(props.onOpen).not.toHaveBeenCalled();
	expect(selectedTitle()).toBe("Open Item a");
	expect(document.querySelector('[role="alert"]')?.textContent).toContain("New activity arrived");
	expect(button("Handle Item a and open next item").disabled).toBe(false);
});

test("a newer occurrence in the receipt refresh stays selected even before React renders the new data", async () => {
	const props = await mount({
		data: data([item("a"), item("b")]),
		onHandled: mock(async () => data([item("a", { revision: 4 }), item("b")])),
	});
	await click("Handle Item a and open next item");
	expect(props.onOpen).not.toHaveBeenCalled();
	expect(selectedTitle()).toBe("Open Item a");
	expect(document.body.textContent).toContain("New activity arrived for this item");
});

test("a failure opening the next item preserves it and does not acknowledge it", async () => {
	const props: Props = await mount({
		data: data([item("a"), item("b")]),
		onHandled: mock(async () => {
			const next = data([item("b")]);
			await render({ ...props, data: next });
			return next;
		}),
		onOpen: mock(async () => {
			throw new Error("Terminal unavailable");
		}),
	});
	await click("Handle Item a and open next item");
	expect(selectedTitle()).toBe("Open Item b");
	expect(props.onHandled).toHaveBeenCalledTimes(1);
	expect(document.querySelector('[role="alert"]')?.textContent).toBe("Terminal unavailable");
});

test("the last handled item shows completion without closing", async () => {
	const props: Props = await mount({
		onHandled: mock(async () => {
			const next = data([]);
			await render({ ...props, data: next });
			return next;
		}),
	});
	await click("Handle Item a and open next item");
	expect(document.body.textContent).toContain("All caught up");
	expect(props.onClose).not.toHaveBeenCalled();
	expect(props.onOpen).not.toHaveBeenCalled();
});

test("Previous and Next navigate without receipts; incoming rows do not jump selection", async () => {
	const props = await mount({ data: data([item("a"), item("b")]) });
	await click("Next item");
	expect(selectedTitle()).toBe("Open Item b");
	await render({ ...props, data: data([item("new", { occurredAt: 2000 }), item("a"), item("b")]) });
	expect(selectedTitle()).toBe("Open Item b");
	await click("Previous item");
	expect(selectedTitle()).toBe("Open Item a");
	expect(props.onHandled).not.toHaveBeenCalled();
});

test("closing during acknowledgment cancels automatic next navigation", async () => {
	let resolve!: (result: ActivityQueueListResult) => void;
	const props = await mount({
		data: data([item("a"), item("b")]),
		onHandled: mock(
			() =>
				new Promise<ActivityQueueListResult>((r) => {
					resolve = r;
				})
		),
	});
	await act(() => button("Handle Item a and open next item").click());
	await act(() => root?.unmount());
	root = undefined;
	await act(() => resolve(data([item("b")])));
	expect(props.onOpen).not.toHaveBeenCalled();
});

test("filters scope the work sequence and handled items opt in", async () => {
	const props = await mount({
		data: data([
			item("a"),
			item("pr", { kind: "pr-review", projectId: "p2", projectName: "Project Two" }),
			item("done", { acknowledged: true }),
		]),
	});
	expect(document.body.textContent).not.toContain("Item done");
	const category = document.querySelector<HTMLSelectElement>('select[aria-label="Category"]');
	if (!category) throw new Error("Missing category");
	await act(() => {
		category.value = "pr-review";
		category.dispatchEvent(new Event("change", { bubbles: true }));
	});
	expect(selectedTitle()).toBe("Open Item pr");
	expect(document.body.textContent).toContain("1 pending in view");
	expect(props.onHandled).not.toHaveBeenCalled();
	await act(() => {
		category.value = "all";
		category.dispatchEvent(new Event("change", { bubbles: true }));
		document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
	});
	expect(document.body.textContent).toContain("Item done");
});

test("warnings remain collapsed and grouped instead of pushing work out of view", async () => {
	const rows = Array.from({ length: 100 }, (_, i) => item(`pr-${i}`));
	await mount({
		data: {
			...data(rows),
			sourceErrors: [
				...rows.map((row) => ({
					sourceId: row.id,
					error: "PR status not confirmed",
					observedAt: 1,
				})),
				{ sourceId: "missing", error: "Historical noise", observedAt: 1 },
			],
		},
	});
	const details = document.querySelector("details");
	expect(details?.open).toBe(false);
	expect(details?.querySelectorAll("li")).toHaveLength(1);
	expect(details?.textContent).toContain("PR status not confirmed (100)");
	expect(document.body.textContent).not.toContain("Historical noise");
});

test("loading, empty, unavailable, error and stale states remain distinct", async () => {
	const props = await mount({ data: undefined, loading: true });
	expect(document.body.textContent).toContain("Loading queue");
	await render({ ...props, loading: false, data: data([]) });
	expect(document.body.textContent).toContain("All caught up");
	await render({ ...props, loading: false, data: { ...data([]), agentStatusAvailable: false } });
	expect(document.body.textContent).toContain("Agent status unavailable");
	expect(document.body.textContent).not.toContain("All caught up");
	await render({
		...props,
		loading: false,
		error: "Disconnected",
		data: data([item("a", { stale: true })]),
	});
	expect(document.body.textContent).toContain("Showing the last available queue");
	expect(document.body.textContent).toContain("Stale");
});

test("dock is labelled and Escape is scoped; terminal keyboard input is not trapped", async () => {
	const props = await mount();
	const aside = document.querySelector("aside");
	expect(document.getElementById(aside?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
		"Queue"
	);
	expect(aside?.getAttribute("aria-modal")).toBeNull();
	const input = document.createElement("textarea");
	document.body.append(input);
	input.focus();
	await act(() =>
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
	);
	expect(props.onClose).not.toHaveBeenCalled();
	await act(() =>
		aside?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
	);
	expect(props.onClose).toHaveBeenCalledTimes(1);
});

test("a disappearing project leaves an explicit empty filter without changing other work", async () => {
	const props = await mount();
	const project = document.querySelector<HTMLSelectElement>('select[aria-label="Project"]');
	if (!project) throw new Error("Missing filter");
	await act(() => {
		project.value = "p1";
		project.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await render({
		...props,
		data: data([item("other", { projectId: "p2", projectName: "Other" })]),
	});
	expect(document.body.textContent).toContain("Selected project (no items)");
	expect(document.body.textContent).toContain("No items in this view");
});

test("arrow keys select within the list without opening sources or trapping terminal input", async () => {
	const props = await mount({ data: data([item("a"), item("b"), item("c")]) });
	button("Open Item a").focus();
	await act(() =>
		button("Open Item a").dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
		)
	);
	expect(selectedTitle()).toBe("Open Item b");
	expect(document.activeElement).toBe(button("Open Item b"));
	expect(button("Open Item a").tabIndex).toBe(-1);
	expect(props.onOpen).not.toHaveBeenCalled();
	await act(() =>
		button("Open Item b").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
	);
	expect(selectedTitle()).toBe("Open Item c");
});
