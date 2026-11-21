import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { WorkspaceQueueItem } from "../src/shared/activity-queue";
import type {
	QueuePermissionDecisionInput,
	QueuePermissionDecisionProps,
} from "../src/shared/queue-permissions";
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
const { QueuePermissionDecision } = await import(
	"../src/renderer/components/queue/QueuePermissionDecision"
);
let root: Root;
afterEach(async () => {
	await act(() => root?.unmount());
	document.body.innerHTML = "";
});
async function mount(overrides: Partial<QueuePermissionDecisionProps> = {}) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const calls: QueuePermissionDecisionInput[] = [];
	let opens = 0;
	await act(() =>
		root.render(
			<QueuePermissionDecision
				item={
					{
						id: "s",
						revision: 4,
						members: [
							{ id: "s", revision: 4 },
							{ id: "report", revision: 2 },
						],
					} as WorkspaceQueueItem
				}
				capability={{
					capability: "hook-response",
					allowOnce: true,
					requestId: "nonce",
					state: "waiting",
					summary: "Bash: printf safe",
					detail: "Waiting",
				}}
				onDecide={async (input) => {
					calls.push(input);
					return { status: "sent", detail: "Provider outcome unknown" };
				}}
				onOpen={() => {
					opens++;
				}}
				{...overrides}
			/>
		)
	);
	return { calls, opens: () => opens };
}
const button = (label: string) =>
	Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label)!;
test("view/hover do nothing; double click carries all exact receipts only once", async () => {
	const f = await mount();
	expect(f.calls).toEqual([]);
	await act(async () => {
		button("Allow once").dispatchEvent(new window.MouseEvent("mouseover"));
	});
	expect(f.calls).toEqual([]);
	const allow = button("Allow once");
	await act(async () => {
		allow.click();
		allow.click();
	});
	expect(f.calls).toEqual([
		{
			id: "s",
			revision: 4,
			members: [
				{ id: "s", revision: 4 },
				{ id: "report", revision: 2 },
			],
			requestId: "nonce",
			action: "allow-once",
		},
	]);
	expect(document.body.textContent).toContain("outcome unknown");
	expect(button("Allow once")).toBeUndefined();
});
test("unsupported capabilities expose Open only", async () => {
	const f = await mount({
		capability: { capability: "unavailable", detail: "Open native prompt" },
	});
	expect(button("Allow once")).toBeUndefined();
	await act(async () => button("Open conversation").click());
	expect(f.opens()).toBe(1);
	expect(f.calls).toEqual([]);
});
test("response loss cannot retry", async () => {
	let calls = 0;
	await mount({
		onDecide: async () => {
			calls++;
			throw Error("lost");
		},
	});
	await act(async () => button("Deny").click());
	expect(calls).toBe(1);
	expect(button("Deny")).toBeUndefined();
	expect(document.body.textContent).toContain("Delivery could not be confirmed");
});
test("explicit Open releases wait before navigation", async () => {
	const sequence: string[] = [];
	await mount({
		onDecide: async (input) => {
			sequence.push(input.action);
			return { status: "opened", detail: "Released" };
		},
		onOpen: () => sequence.push("navigate"),
	});
	await act(async () => button("Open conversation").click());
	expect(sequence).toEqual(["open", "navigate"]);
});

test("a stable request expires in place and Open navigates without a stale decision", async () => {
	const capability = {
		capability: "hook-response" as const,
		allowOnce: true,
		requestId: "expiring",
		state: "waiting" as const,
		expiresAt: Date.now() + 80,
		summary: "Bash: printf safe",
		detail: "Waiting",
	};
	const f = await mount({ capability });
	expect(button("Allow once")).toBeDefined();
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 120));
	});
	expect(button("Allow once")).toBeUndefined();
	expect(button("Deny")).toBeUndefined();
	expect(document.body.textContent).toContain("expired");
	await act(async () => button("Open conversation").click());
	expect(f.calls).toEqual([]);
	expect(f.opens()).toBe(1);
});
