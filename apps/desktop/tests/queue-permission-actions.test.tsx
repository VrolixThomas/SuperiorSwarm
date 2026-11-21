import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { WorkspaceQueueItem } from "../src/shared/activity-queue";
import type { QueuePermissionCapability } from "../src/shared/queue-permissions";
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
const { QueuePermissionActions } = await import(
	"../src/renderer/components/queue/QueuePermissionActions"
);
let root: Root;
afterEach(async () => {
	await act(() => root?.unmount());
	document.body.innerHTML = "";
});
test("changed permission occurrence never exposes preceding request's controls during capability fetch", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const item = {
		id: "source",
		revision: 1,
		permission: { requestId: "old", outcome: "pending" },
		target: { type: "terminal", terminalId: "owner" },
	} as WorkspaceQueueItem;
	let resolveNext: (value: QueuePermissionCapability) => void = () => {};
	const actions = {
		capability: async (input: { revision: number }) =>
			input.revision === 1
				? {
						capability: "hook-response" as const,
						requestId: "old",
						allowOnce: true,
						state: "waiting" as const,
						detail: "Old request",
					}
				: await new Promise<QueuePermissionCapability>((resolve) => {
						resolveNext = resolve;
					}),
		decide: async () => ({ status: "sent" as const, detail: "sent" }),
	};
	const render = (value: WorkspaceQueueItem) =>
		root.render(
			<QueuePermissionActions
				item={value}
				available
				actions={actions}
				onOpen={() => {}}
				refresh={async () => {}}
			/>
		);
	await act(async () => {
		render(item);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(
		[...document.querySelectorAll("button")].some(
			(button) => button.textContent?.includes("Allow") && !button.disabled
		)
	).toBe(true);
	await act(async () => {
		render({ ...item, revision: 2, permission: { requestId: "new", outcome: "pending" } });
		await Promise.resolve();
	});
	expect(
		[...document.querySelectorAll("button")].some(
			(button) => button.textContent?.includes("Allow") && !button.disabled
		)
	).toBe(false);
	await act(async () => {
		resolveNext({ capability: "unavailable", detail: "New request unavailable" });
		await Promise.resolve();
	});
	expect(document.body.textContent).toContain("New request unavailable");
});
