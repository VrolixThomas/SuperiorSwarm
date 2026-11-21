import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { QueueLinkedWork } from "../src/shared/queue-linked-context";
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
const { QueueLinkedWorkContext } = await import(
	"../src/renderer/components/queue/QueueLinkedWorkContext"
);
let root: Root;
afterEach(async () => {
	await act(() => root?.unmount());
	document.body.innerHTML = "";
});
const links: QueueLinkedWork[] = [
	{
		kind: "ticket",
		provider: "linear",
		id: "issue",
		label: "SUP-4",
		title: "Fix followups",
		metadata: "cached",
		url: "https://linear.app/superiorset/issue/SUP-4",
	},
	{
		kind: "ticket",
		provider: "jira",
		id: "SUP-4",
		label: "SUP-4",
		metadata: "unavailable",
		unavailableReason: "Jira site unavailable",
	},
];
async function mount(items?: QueueLinkedWork[], compact = false) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(() => root.render(<QueueLinkedWorkContext items={items} compact={compact} />));
	return host;
}
test("context shows title and cache status; unknown scoped link has no open button", async () => {
	const host = await mount(links);
	expect(host.textContent).toContain("Fix followups");
	expect(host.textContent).toContain("Last synced details");
	expect(host.textContent).toContain("Jira site unavailable");
	expect(host.querySelectorAll("button")).toHaveLength(1);
});
test("browser failures are visible without dismissing the linked work", async () => {
	const urls: string[] = [];
	Object.defineProperty(window, "electron", {
		configurable: true,
		value: {
			shell: {
				openExternal: async (url: string) => {
					urls.push(url);
					throw Error("Offline");
				},
			},
		},
	});
	const host = await mount(links);
	await act(async () => {
		host.querySelector("button")?.click();
		await Promise.resolve();
	});
	expect(urls).toEqual(["https://linear.app/superiorset/issue/SUP-4"]);
	expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not open");
	expect(host.textContent).toContain("Fix followups");
});
test("compact header keeps complete context discoverable; no empty header control", async () => {
	const host = await mount(links, true);
	expect(host.querySelector("summary")?.textContent).toBe("Linked work (2)");
	expect(host.querySelector("details")?.open).toBe(false);
	await act(() => root.render(<QueueLinkedWorkContext items={[]} compact />));
	expect(host.textContent).toBe("");
});
