import { expect, test } from "bun:test";
import { Window } from "happy-dom";
const browser = new Window();
Object.defineProperty(globalThis, "matchMedia", {
	configurable: true,
	value: browser.matchMedia.bind(browser),
});
if (typeof window === "undefined")
	Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
const { registerCoreActions } = await import("../src/renderer/actions/core-actions");
import { matchesShortcut } from "../src/renderer/hooks/useShortcutListener";
import { useActionStore } from "../src/renderer/stores/action-store";
import { useQueueNavigationStore } from "../src/renderer/stores/queue-navigation-store";
import type { WorkspaceQueueItem } from "../src/shared/activity-queue";

test("queue chords do not collide with registered core bindings or replace existing navigation", () => {
	registerCoreActions();
	const actions = Array.from(useActionStore.getState().actions.values());
	for (const shift of [false, true])
		for (const ctrl of [false, true]) {
			const event = {
				key: shift ? "J" : "j",
				code: "KeyJ",
				metaKey: !ctrl,
				ctrlKey: ctrl,
				shiftKey: shift,
				altKey: false,
			} as KeyboardEvent;
			expect(
				actions.filter((a) => a.shortcut && matchesShortcut(event, a.shortcut)).map((a) => a.id)
			).toEqual([shift ? "queue.peek" : "queue.next"]);
		}
	expect(actions.find((a) => a.id === "nav.repos")?.shortcut).toEqual({ key: "1", meta: true });
	expect(actions.find((a) => a.id === "view.toggleSidebar")?.shortcut).toEqual({
		key: "b",
		meta: true,
	});
});
test("shortcut gestures only request navigation and peek; they do not select or mutate receipts", () => {
	useQueueNavigationStore.setState({ session: null, peekOpen: false, jumpRequest: 0 });
	useActionStore.getState().execute("queue.next");
	expect(useQueueNavigationStore.getState().session).toBeNull();
	expect(useQueueNavigationStore.getState().jumpRequest).toBe(1);
	useActionStore.getState().execute("queue.peek");
	expect(useQueueNavigationStore.getState().peekOpen).toBe(true);
	useActionStore.getState().execute("queue.peek");
	expect(useQueueNavigationStore.getState().peekOpen).toBe(false);
});
test("opening a Later or absent occurrence does not bind a pending navigation session", () => {
	const item = {
		id: "later",
		revision: 1,
		snoozed: { until: null, untilChange: true },
	} as WorkspaceQueueItem;
	useQueueNavigationStore.getState().select(item, [item]);
	expect(useQueueNavigationStore.getState().session).toBeNull();
	useQueueNavigationStore.getState().select({ ...item, snoozed: undefined }, []);
	expect(useQueueNavigationStore.getState().session).toBeNull();
});
