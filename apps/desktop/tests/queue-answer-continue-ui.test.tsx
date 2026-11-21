import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type {
	WorkspaceQueueItem,
	WorkspaceQueueReplyCapability,
} from "../src/shared/activity-queue";
import type {
	QueueAnswerContinueInput,
	QueueAnswerContinueResult,
	QueueAnswerReceiptInput,
} from "../src/shared/queue-answer-continuation";
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
	id: "q-source",
	revision: 4,
	members: [{ id: "q-source", revision: 4 }],
	question: { messageId: "question", replyCapability: "mcp-inbox" },
	target: {
		type: "terminal",
		entity: { kind: "workspace", id: "w" },
		workspaceId: "w",
		terminalId: "owner",
		provider: "codex",
		providerSessionId: "chat",
	},
	context: {
		workspaceId: "w",
		workspaceName: "Task",
		projectName: "Repo",
		terminalTitle: "Question",
	},
} as WorkspaceQueueItem;
async function mount(initial = item) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	let current = initial;
	let capability: WorkspaceQueueReplyCapability = {
		status: "available",
		mode: "reply",
		detail: "Continue exact chat",
	};
	let result: QueueAnswerContinueResult | Error = {
		answer: { messageId: "answer", content: "Use blue", delivery: "saved" },
		continuation: {
			status: "admitted",
			requestId: "recorded",
			detail: "Submitted, waiting for the agent",
		},
	};
	let receipt: QueueAnswerContinueResult | Promise<QueueAnswerContinueResult> = {
		answer: null,
		continuation: {
			status: "uncertain",
			requestId: "recorded",
			detail: "Not confirmed; no resend",
		},
	};
	const sends: QueueAnswerContinueInput[] = [];
	const checks: QueueAnswerReceiptInput[] = [];
	let saves = 0;
	const actions = {
		capability: async () => capability,
		continue: async (input: QueueAnswerContinueInput) => {
			sends.push(input);
			if (result instanceof Error) throw result;
			return result;
		},
		receipt: async (input: QueueAnswerReceiptInput) => {
			checks.push(input);
			return receipt;
		},
	};
	const render = () =>
		root.render(
			<QueueQuestionReply
				item={current}
				available
				answer={async () => {
					saves++;
					return { status: "saved", messageId: "saved-only", delivery: "saved", detail: "Saved" };
				}}
				continuationActions={actions}
				refresh={async () => {}}
			/>
		);
	await act(async () => {
		render();
		await Promise.resolve();
	});
	return {
		sends,
		checks,
		saves: () => saves,
		setResult: (value: typeof result) => {
			result = value;
		},
		setReceipt: (value: typeof receipt) => {
			receipt = value;
		},
		setCapability: async (value: WorkspaceQueueReplyCapability) => {
			capability = value;
			current = { ...current };
			await act(async () => {
				render();
				await Promise.resolve();
			});
		},
		update: async (value: WorkspaceQueueItem) => {
			current = value;
			await act(async () => {
				render();
				await Promise.resolve();
			});
		},
	};
}
function button(label: string) {
	const b = Array.from(browser.document.querySelectorAll("button")).find(
		(b) => b.textContent === label
	);
	if (!b) throw Error(`Missing ${label}`);
	return b;
}
async function type(content: string) {
	await act(() => {
		const el = browser.document.querySelector("textarea");
		if (!el) throw Error("Missing answer input");
		Object.getOwnPropertyDescriptor(browser.HTMLTextAreaElement.prototype, "value")?.set?.call(
			el,
			content
		);
		el.dispatchEvent(new browser.Event("input", { bubbles: true }));
	});
}
async function click(label: string) {
	await act(async () => {
		button(label).click();
		await Promise.resolve();
	});
}
test("explicit Send & continue submits the full displayed receipt once, independent of save-only", async () => {
	const f = await mount();
	await type("Use blue");
	const controls = Array.from(browser.document.querySelectorAll("button"));
	expect(controls.indexOf(button("Send & continue"))).toBeLessThan(
		controls.indexOf(button("Save answer only"))
	);
	await act(async () => {
		const send = button("Send & continue");
		send.click();
		send.click();
		await Promise.resolve();
	});
	expect(f.sends).toHaveLength(1);
	expect(f.saves()).toBe(0);
	expect(f.sends[0]).toMatchObject({
		id: item.id,
		revision: 4,
		members: item.members,
		questionId: "question",
		content: "Use blue",
	});
	expect(document.body.textContent).toContain("Saved. The agent has not read this answer yet.");
	expect(document.body.textContent).toContain("Submitted, waiting for the agent");
});
test("lost mutation result locks the request and Check status only performs read-only recovery", async () => {
	const f = await mount();
	f.setResult(Error("Disconnected"));
	await type("Use blue");
	await click("Send & continue");
	expect(f.sends).toHaveLength(1);
	expect(browser.document.querySelector("textarea")?.disabled).toBe(true);
	await click("Check continuation status");
	expect(f.sends).toHaveLength(1);
	expect(f.checks).toHaveLength(1);
	expect(f.checks[0]?.requestId).toBe(f.sends[0]?.requestId);
	expect(f.saves()).toBe(0);
	expect(document.body.textContent).toContain("Not confirmed; no resend");
});
test("definite continuation failure preserves saved answer and offers explicit continuation retry", async () => {
	const f = await mount();
	f.setResult({
		answer: { messageId: "answer", content: "Use blue", delivery: "saved" },
		continuation: { status: "unavailable", reason: "Chat became busy; saved answer retained" },
	});
	await type("Use blue");
	await click("Send & continue");
	expect(document.body.textContent).toContain("Your answer: Use blue");
	expect(document.body.textContent).toContain("Chat became busy");
	await act(async () => {
		await Promise.resolve();
	});
	await click("Continue with saved answer");
	expect(f.sends).toHaveLength(2);
	expect(f.sends[1]?.answerId).toBe("answer");
	expect(f.sends[1]?.content).toBe("Use blue");
	expect(f.sends[1]?.requestId).not.toBe(f.sends[0]?.requestId);
	expect(f.saves()).toBe(0);
});
test("an existing saved answer continues the persisted content without another save", async () => {
	const f = await mount({
		...item,
		question: {
			...item.question!,
			answer: { messageId: "outside-answer", delivery: "saved", content: "Persisted answer" },
		},
	});
	await click("Continue with saved answer");
	expect(f.sends[0]).toMatchObject({ answerId: "outside-answer", content: "Persisted answer" });
	expect(f.saves()).toBe(0);
});
test("target or grouped receipt changes never rebase a typed answer implicitly", async () => {
	const f = await mount();
	await type("Use blue");
	await f.update({
		...item,
		target: {
			...item.target,
			type: "terminal",
			workspaceId: "w",
			terminalId: "replacement",
			provider: "codex",
			providerSessionId: "other",
		},
	});
	expect(button("Send & continue").disabled).toBe(true);
	expect(button("Save answer only").disabled).toBe(true);
	expect(f.sends).toHaveLength(0);
	expect(browser.document.querySelector("textarea")?.value).toBe("Use blue");
});
test("unavailable continuation keeps the explicit save-only path usable", async () => {
	const f = await mount();
	await f.setCapability({ status: "unavailable", reason: "Open this chat to continue" });
	await type("Use blue");
	expect(button("Send & continue").disabled).toBe(true);
	await click("Save answer only");
	expect(f.saves()).toBe(1);
	expect(f.sends).toHaveLength(0);
});

test("a late earlier status response cannot downgrade a received continuation", async () => {
	const f = await mount();
	await type("Use blue");
	await click("Send & continue");
	let resolveOld: (value: QueueAnswerContinueResult) => void = () => {};
	f.setReceipt(
		new Promise((resolve) => {
			resolveOld = resolve;
		})
	);
	await act(async () => {
		button("Check continuation status").click();
		await Promise.resolve();
	});
	f.setReceipt({
		answer: { messageId: "answer", content: "Use blue", delivery: "retrieved" },
		continuation: { status: "received", requestId: "recorded", detail: "Matching answer received" },
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 1550));
	});
	await act(async () => {
		resolveOld({
			answer: { messageId: "answer", content: "Use blue", delivery: "saved" },
			continuation: {
				status: "uncertain",
				requestId: "recorded",
				detail: "Older pending response",
			},
		});
		await Promise.resolve();
	});
	expect(document.body.textContent).toContain("Matching answer received");
	expect(document.body.textContent).not.toContain("Older pending response");
	expect(f.sends).toHaveLength(1);
});
