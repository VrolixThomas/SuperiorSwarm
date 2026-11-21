import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type {
	WorkspaceQueueItem,
	WorkspaceQueueReplyInput,
	WorkspaceQueueReplyResult,
} from "../src/shared/activity-queue";
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
const { QueueConversationReply } = await import(
	"../src/renderer/components/queue/QueueConversationReply"
);
let root: Root;
afterEach(async () => {
	await act(() => root?.unmount());
	document.body.innerHTML = "";
});
const original = {
	id: "source",
	revision: 3,
	members: [
		{ id: "source", revision: 3 },
		{ id: "turn", revision: 8 },
	],
	situation: "agent-done",
	target: {
		type: "terminal",
		terminalId: "exact",
		workspaceId: "owner",
		provider: "claude",
		providerSessionId: "chat",
	},
	context: { terminalTitle: "Exact chat", workspaceName: "Workspace" },
} as WorkspaceQueueItem;
async function fixture() {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	let item = original;
	let result: WorkspaceQueueReplyResult | Error = {
		status: "admitted",
		requestId: "echo",
		detail: "Terminal admission only; model receipt unconfirmed.",
	};
	const calls: WorkspaceQueueReplyInput[] = [];
	const receipts: string[] = [];
	const actions = {
		receipt: async (requestId: string) => {
			receipts.push(requestId);
			if (result instanceof Error) throw result;
			return result;
		},
		capability: async () => ({
			status: "available" as const,
			mode: "reply" as const,
			detail: "Exact provider",
		}),
		reply: async (input: WorkspaceQueueReplyInput) => {
			calls.push(input);
			if (result instanceof Error) throw result;
			return result;
		},
	};
	const render = () =>
		root.render(
			<QueueConversationReply item={item} available actions={actions} refresh={async () => {}} />
		);
	await act(async () => {
		render();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	const type = async (text: string) =>
		act(() => {
			const el = browser.document.querySelector("textarea")!;
			Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value")?.set?.call(
				el,
				text
			);
			el.dispatchEvent(new browser.Event("input", { bubbles: true }));
		});
	const click = async () =>
		act(async () => {
			document
				.querySelectorAll("button")
				.item(document.querySelectorAll("button").length - 1)!
				.click();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	return {
		calls,
		receipts,
		type,
		click,
		setResult: (value: typeof result) => {
			result = value;
		},
		render: async (value: WorkspaceQueueItem) => {
			item = value;
			await act(async () => {
				render();
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
		},
	};
}
test("reply submits displayed full group once and labels only terminal admission", async () => {
	const f = await fixture();
	await f.type("Hello exact chat");
	await f.click();
	await f.click();
	expect(f.calls).toHaveLength(1);
	expect(f.calls[0]?.members).toEqual(original.members);
	expect(f.calls[0]?.revision).toBe(3);
	expect(document.body.textContent).toContain("model receipt unconfirmed");
	expect(document.querySelector("textarea")?.value).toBe("Hello exact chat");
});
test("transport error check uses identical request/content and preserves draft", async () => {
	const f = await fixture();
	f.setResult(Error("disconnected"));
	await f.type("Keep me");
	await f.click();
	expect(document.body.textContent).toContain("Delivery is uncertain");
	await f.click();
	expect(f.calls).toHaveLength(1);
	expect(f.receipts.every((id) => id === f.calls[0]?.requestId)).toBe(true);
	expect(document.querySelector("textarea")?.value).toBe("Keep me");
});
test("group member or exact conversation replacement cannot rebase a typed reply", async () => {
	const f = await fixture();
	await f.type("old occurrence");
	await f.render({
		...original,
		members: [
			{ id: "source", revision: 3 },
			{ id: "turn", revision: 9 },
		],
	});
	await f.click();
	expect(f.calls).toHaveLength(0);
	expect(document.body.textContent).toContain("occurrence changed");
	expect(document.querySelector("textarea")?.value).toBe("old occurrence");
});
test("definite unavailable permits editing and an explicit new attempt without automatic send", async () => {
	const f = await fixture();
	f.setResult({ status: "unavailable", reason: "Temporarily unavailable" });
	await f.type("first");
	await f.click();
	expect(f.calls).toHaveLength(1);
	expect(document.querySelector("textarea")?.disabled).toBe(false);
	await f.type("revised");
	await f.click();
	expect(f.calls).toHaveLength(2);
	expect(f.calls[0]?.requestId).not.toBe(f.calls[1]?.requestId);
	expect(f.calls[1]?.content).toBe("revised");
});
test("Enter submits an ordinary reply while Shift, modifiers, repeats and IME never submit", async () => {
	const f = await fixture();
	await f.type("keyboard reply");
	const input = browser.document.querySelector("textarea")!;
	for (const options of [
		{ shiftKey: true },
		{ ctrlKey: true },
		{ metaKey: true },
		{ repeat: true },
		{ isComposing: true },
	]) {
		await act(async () => {
			input.dispatchEvent(
				new browser.KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
					...options,
				})
			);
			await Promise.resolve();
		});
	}
	expect(f.calls).toHaveLength(0);
	await act(async () => {
		input.dispatchEvent(
			new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	expect(f.calls).toHaveLength(1);
	expect(f.calls[0]?.content).toBe("keyboard reply");
});
