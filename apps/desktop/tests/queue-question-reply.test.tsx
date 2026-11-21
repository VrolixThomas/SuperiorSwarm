import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type {
	WorkspaceQueueAnswerInput,
	WorkspaceQueueAnswerResult,
	WorkspaceQueueItem,
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
const { QueueQuestionReply } = await import("../src/renderer/components/queue/QueueQuestionReply");
let root: Root;
afterEach(async () => {
	await act(() => root?.unmount());
	document.body.innerHTML = "";
});
const item = {
	id: "question-item",
	revision: 7,
	question: { messageId: "question-42", replyCapability: "mcp-inbox" },
	target: {
		type: "terminal",
		workspaceId: "owner",
		terminalId: "reporter",
		provider: "codex",
		providerSessionId: "conversation-2",
	},
	context: {
		workspaceId: "owner",
		workspaceName: "Reporter workspace",
		terminalTitle: "Choose a color",
		entity: { kind: "workspace", id: "owner" },
		role: "workspace",
	},
} as WorkspaceQueueItem;
async function mount() {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	let current = item;
	const calls: WorkspaceQueueAnswerInput[] = [];
	let result: WorkspaceQueueAnswerResult | Error = {
		status: "saved",
		messageId: "answer-42",
		delivery: "saved",
		detail: "Saved",
	};
	let refreshError = false;
	const render = () =>
		root.render(
			<QueueQuestionReply
				item={current}
				available
				answer={async (input) => {
					calls.push(input);
					if (result instanceof Error) throw result;
					return result;
				}}
				refresh={async () => {
					if (refreshError) throw Error("Disconnected after save");
				}}
			/>
		);
	await act(render);
	return {
		calls,
		result: (value: typeof result) => {
			result = value;
		},
		refreshError: () => {
			refreshError = true;
		},
		update: async (next: WorkspaceQueueItem) => {
			current = next;
			await act(render);
		},
	};
}
async function type(value: string) {
	const input = document.querySelector("textarea");
	if (!input) throw Error("Missing answer");
	await act(() => {
		Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
			input,
			value
		);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
		input.dispatchEvent(new window.Event("change", { bubbles: true }));
	});
}
async function click(label: string) {
	const button = [...document.querySelectorAll("button")].find((b) => b.textContent === label);
	if (!button) throw Error(`Missing ${label}`);
	await act(async () => {
		button.click();
		await new Promise((r) => setTimeout(r, 0));
	});
}
test("correlated answer uses displayed message, owner and revision; saved is not retrieved or resumed", async () => {
	const f = await mount();
	await type("Blue");
	expect(document.body.textContent).toContain("conversation-2");
	await click("Send answer");
	expect(f.calls).toEqual([
		{ id: "question-item", revision: 7, questionId: "question-42", content: "Blue" },
	]);
	expect(document.body.textContent).toContain("has not read this answer yet");
	expect(document.body.textContent).toContain("does not resume the task");
	expect(document.querySelector("textarea")).toBeNull();
});
test("transport error preserves input; stale revision refuses send until explicitly reviewed", async () => {
	const f = await mount();
	f.result(Error("Inbox unavailable\nRetry after reconnecting."));
	await type("Amber");
	await click("Send answer");
	expect(document.querySelector("textarea")?.value).toBe("Amber");
	expect(document.querySelector('[role="alert"]')?.textContent).toBe(
		"Inbox unavailable\nRetry after reconnecting."
	);
	expect(document.querySelector('[role="alert"]')?.className).toContain("whitespace-pre-wrap");
	await f.update({ ...item, revision: 8 });
	await click("Send answer");
	expect(f.calls).toHaveLength(1);
	expect(document.body.textContent).toContain("Your draft is preserved");
	await click("Use reviewed question revision");
	f.result({ status: "saved", messageId: "a", delivery: "saved", detail: "Saved" });
	await click("Send answer");
	expect(f.calls[1]?.revision).toBe(8);
});
test("backend conflict preserves the pending answer and does not claim delivery", async () => {
	const f = await mount();
	f.result({ status: "conflict" });
	await type("Blue");
	await click("Send answer");
	expect(document.querySelector("textarea")?.value).toBe("Blue");
	expect(document.body.textContent).toContain("question changed");
	expect(document.body.textContent).not.toContain("has not read this answer yet");
});
test("refresh failure after saved cannot reenable duplicate delivery", async () => {
	const f = await mount();
	f.refreshError();
	await type("Blue");
	await click("Send answer");
	expect(f.calls).toHaveLength(1);
	expect(document.querySelector("textarea")).toBeNull();
	expect(document.body.textContent).toContain("has not read this answer yet");
});
test("drafts remain associated with their question when selecting another item", async () => {
	const f = await mount();
	await type("For original only");
	await f.update({
		...item,
		id: "other",
		question: { messageId: "other-q", replyCapability: "mcp-inbox" },
	});
	expect(document.querySelector("textarea")?.value).toBe("");
	await f.update(item);
	expect(document.querySelector("textarea")?.value).toBe("For original only");
});

test("persisted saved answer remains readable after remount without claiming task execution", async () => {
	const f = await mount();
	await f.update({
		...item,
		question: {
			messageId: "question-42",
			replyCapability: "mcp-inbox",
			answer: { messageId: "answer-42", delivery: "saved", content: "Previously saved answer" },
		},
	});
	expect(document.body.textContent).toContain("Your answer: Previously saved answer");
	expect(document.body.textContent).toContain("has not read this answer yet");
	expect(document.querySelector("textarea")).toBeNull();
	expect(f.calls).toHaveLength(0);
});

test("recipient uses human names once and keeps binding identifiers in collapsed technical details", async () => {
	const f = await mount();
	await f.update({
		...item,
		context: {
			...item.context,
			projectName: "Color project",
			workspaceName: "Choose a color",
			terminalTitle: "Choose a color",
		},
	});
	const recipient = document.querySelector('[aria-label="Answer recipient"]');
	expect(recipient?.textContent).toBe("Recipient: Color project / Choose a color · Codex");
	const details = document.querySelector("details");
	expect(details?.querySelector("summary")?.textContent).toBe("Technical details");
	expect(details?.open).toBe(false);
	for (const id of ["owner", "reporter", "conversation-2", "question-42"]) {
		expect(details?.textContent).toContain(id);
		expect(recipient?.textContent).not.toContain(id);
	}
	const visibleCopy = document.querySelector("section")?.cloneNode(true) as HTMLElement;
	visibleCopy.querySelector("details")?.remove();
	for (const id of ["owner", "reporter", "conversation-2", "question-42"])
		expect(visibleCopy.textContent).not.toContain(id);
	await type("Blue\nKeep the second line.");
	await click("Send answer");
	expect(f.calls[0]).toEqual({
		id: "question-item",
		revision: 7,
		questionId: "question-42",
		content: "Blue\nKeep the second line.",
	});
	const saved = document.querySelector("output p");
	expect(saved?.textContent).toBe("Your answer: Blue\nKeep the second line.");
	expect(saved?.className).toContain("whitespace-pre-wrap");
});

test("coordinator recipient names its own chat rather than a linked project", async () => {
	const f = await mount();
	await f.update({
		...item,
		context: {
			...item.context,
			role: "coordinator",
			projectName: "Cross-repository coordinator",
			workspaceName: "Release coordinator",
			terminalTitle: "Release planning",
		},
	});
	expect(document.querySelector('[aria-label="Answer recipient"]')?.textContent).toBe(
		"Recipient: Release coordinator · Codex · Release planning"
	);
});
