import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { WorkspaceQueueItem } from "../src/shared/activity-queue";
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
const { QueuePeek } = await import("../src/renderer/components/queue/QueuePeek");
const { QueueBarContent } = await import("../src/renderer/components/queue/QueueBar");
const { bindQueueSession } = await import("../src/renderer/lib/queue-navigation-session");
let root: Root | undefined;
afterEach(async () => {
	await act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = "";
});
function row(id: string, revision = 1): WorkspaceQueueItem {
	return {
		id,
		revision,
		kind: "agent-input",
		occurredAt: 0,
		acknowledged: false,
		stale: false,
		title: id,
		subject: id,
		why: "Needs response",
		clearsWhen: "Clears on confirmed continuation",
		summary: "Waiting",
		sourceLabel: "Agent",
		nextAction: "Reply",
		openLabel: "Open",
		detailLabel: "Details",
		evidence: [],
		reasons: [],
		category: "agents",
		situation: "agent-input",
		target: {
			type: "terminal",
			workspaceId: "ws",
			entity: { kind: "workspace", id: "ws" },
			terminalId: id,
			provider: "codex",
			providerSessionId: "conversation",
		},
		context: {
			entity: { kind: "workspace", id: "ws" },
			workspaceId: "ws",
			workspaceName: "Workspace",
			projectName: "Project",
			projectTint: 1,
		},
	};
}
async function mountPeek(initial = [row("a"), row("b")]) {
	const origin = document.createElement("textarea");
	origin.className = "xterm-helper-textarea";
	document.body.append(origin);
	origin.focus();
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	let items = initial;
	let showing = true;
	let available = true;
	const calls: string[] = [];
	const draw = () =>
		root?.render(
			showing ? (
				<QueuePeek
					items={items}
					available={available}
					close={() => {
						showing = false;
						draw();
					}}
					open={(item) => calls.push(`open:${item.id}:${item.revision}`)}
					openQueue={() => calls.push("queue")}
					actions={(item, disabled) => (
						<>
							<textarea aria-label="Reply" />
							<button
								type="button"
								data-queue-done
								disabled={disabled}
								onClick={() => calls.push(`done:${item.id}:${item.revision}`)}
							>
								Done
							</button>
						</>
					)}
				/>
			) : null
		);
	await act(draw);
	return {
		calls,
		origin,
		update: async (next: WorkspaceQueueItem[], isAvailable = true) => {
			items = next;
			available = isAvailable;
			await act(draw);
		},
	};
}
async function key(
	key: string,
	target: Element = document.querySelector('[aria-label="Queue peek"]')!,
	extras = {}
) {
	await act(() =>
		target.dispatchEvent(
			new browser.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
				...extras,
			}) as unknown as Event
		)
	);
}
test("peek owns focus, suppresses letter actions during typing, restores terminal focus on Escape", async () => {
	const state = await mountPeek();
	expect(document.activeElement?.tagName).toBe("DIALOG");
	const input = document.querySelector("[aria-label=Reply]")!;
	await key("e", input);
	expect(state.calls).toEqual([]);
	await key("e");
	expect(state.calls).toEqual(["done:a:1"]);
	await key("Escape", input);
	expect(document.querySelector('[aria-label="Queue peek"]')).toBeNull();
	expect(document.activeElement).toBe(state.origin);
});
test("refresh never adopts changed occurrence; explicit selection accepts latest receipt", async () => {
	const state = await mountPeek();
	await state.update([row("a", 2), row("b")]);
	await key("e");
	expect(state.calls).toEqual([]);
	expect(document.body.textContent).toContain("Updated — select");
	await act(() => document.querySelector<HTMLButtonElement>('[data-queue-row="a"]')?.click());
	await key("e");
	expect(state.calls).toEqual(["done:a:2"]);
	await state.update([row("b")]);
	await key("Enter");
	expect(state.calls).toEqual(["done:a:2"]);
	expect(document.body.textContent).toContain("Cleared");
});
test("peek limits rows, excludes Later, does not navigate or acknowledge on viewing or refresh", async () => {
	const state = await mountPeek([
		...Array.from({ length: 9 }, (_, i) => row(String(i))),
		{ ...row("later"), snoozed: { until: null, untilChange: true } },
	]);
	expect(document.querySelectorAll("[data-queue-row]").length).toBe(7);
	expect(state.calls).toEqual([]);
	await key("ArrowDown");
	expect(state.calls).toEqual([]);
	await key("Enter");
	expect(state.calls).toEqual(["open:1:1"]);
	await state.update([row("1")], false);
	await key("e");
	expect(state.calls).toEqual(["open:1:1"]);
});
test("Tab and Shift Tab wrap within peek", async () => {
	await mountPeek();
	const dialog = document.querySelector('[aria-label="Queue peek"]')!;
	await key("Tab", dialog);
	expect(document.activeElement?.textContent).toBe("Close · Esc");
	await key("Tab", document.activeElement!, { shiftKey: true });
	expect(document.activeElement?.textContent).toBe("Open Queue");
	await key("Tab", document.activeElement!);
	expect(document.activeElement?.textContent).toBe("Close · Esc");
});
test("queue bar is buttons only: terminal letter input never dismisses activity", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	let next = 0;
	await act(() =>
		root?.render(
			<QueueBarContent
				session={bindQueueSession(row("a"), [row("a")])}
				status="cleared"
				next={() => next++}
				close={() => {}}
				actions={null}
			/>
		)
	);
	await key("e", host);
	expect(next).toBe(0);
	await act(() =>
		Array.from(document.querySelectorAll("button"))
			.find((b) => b.textContent?.startsWith("Next"))
			?.click()
	);
	expect(next).toBe(1);
	expect(host.textContent).toContain("Cleared");
});
