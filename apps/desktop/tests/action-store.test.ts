import { beforeEach, describe, expect, test } from "bun:test";
import { shouldSkipShortcutHandling } from "../src/renderer/hooks/useShortcutListener";
import { useActionStore } from "../src/renderer/stores/action-store";

function resetStore() {
	useActionStore.setState({
		actions: new Map(),
		isPaletteOpen: false,
	});
}

describe("action registration", () => {
	beforeEach(resetStore);

	test("registers an action", () => {
		useActionStore.getState().register({
			id: "test.action",
			label: "Test Action",
			category: "General",
			execute: () => {},
		});
		const state = useActionStore.getState();
		expect(state.actions.size).toBe(1);
		expect(state.actions.get("test.action")?.label).toBe("Test Action");
	});

	test("unregisters an action", () => {
		const store = useActionStore.getState();
		store.register({
			id: "test.action",
			label: "Test Action",
			category: "General",
			execute: () => {},
		});
		store.unregister("test.action");
		expect(useActionStore.getState().actions.size).toBe(0);
	});

	test("overwrites action with same id", () => {
		const store = useActionStore.getState();
		store.register({
			id: "test.action",
			label: "First",
			category: "General",
			execute: () => {},
		});
		store.register({
			id: "test.action",
			label: "Second",
			category: "General",
			execute: () => {},
		});
		expect(useActionStore.getState().actions.get("test.action")?.label).toBe("Second");
	});
});

describe("execute", () => {
	beforeEach(resetStore);

	test("calls the action handler", () => {
		let called = false;
		const store = useActionStore.getState();
		store.register({
			id: "test.action",
			label: "Test",
			category: "General",
			execute: () => {
				called = true;
			},
		});
		store.execute("test.action");
		expect(called).toBe(true);
	});

	test("skips action when guard returns false", () => {
		let called = false;
		const store = useActionStore.getState();
		store.register({
			id: "test.guarded",
			label: "Guarded",
			category: "General",
			when: () => false,
			execute: () => {
				called = true;
			},
		});
		store.execute("test.guarded");
		expect(called).toBe(false);
	});

	test("executes action when guard returns true", () => {
		let called = false;
		const store = useActionStore.getState();
		store.register({
			id: "test.guarded",
			label: "Guarded",
			category: "General",
			when: () => true,
			execute: () => {
				called = true;
			},
		});
		store.execute("test.guarded");
		expect(called).toBe(true);
	});

	test("does nothing for unknown action id", () => {
		const store = useActionStore.getState();
		store.execute("nonexistent.action");
	});
});

describe("getAvailable", () => {
	beforeEach(resetStore);

	test("returns actions without guards", () => {
		const store = useActionStore.getState();
		store.register({
			id: "test.a",
			label: "A",
			category: "General",
			execute: () => {},
		});
		const available = store.getAvailable();
		expect(available.length).toBe(1);
		expect(available[0]?.id).toBe("test.a");
	});

	test("excludes actions where guard returns false", () => {
		const store = useActionStore.getState();
		store.register({
			id: "test.hidden",
			label: "Hidden",
			category: "General",
			when: () => false,
			execute: () => {},
		});
		store.register({
			id: "test.visible",
			label: "Visible",
			category: "General",
			execute: () => {},
		});
		const available = useActionStore.getState().getAvailable();
		expect(available.length).toBe(1);
		expect(available[0]?.id).toBe("test.visible");
	});
});

describe("getShortcutForId", () => {
	beforeEach(resetStore);

	test("returns shortcut when action has one", () => {
		const store = useActionStore.getState();
		store.register({
			id: "test.shortcut",
			label: "With Shortcut",
			category: "General",
			shortcut: { key: "k", meta: true },
			execute: () => {},
		});
		const shortcut = store.getShortcutForId("test.shortcut");
		expect(shortcut?.key).toBe("k");
		expect(shortcut?.meta).toBe(true);
	});

	test("returns undefined when action has no shortcut", () => {
		const store = useActionStore.getState();
		store.register({
			id: "test.none",
			label: "No Shortcut",
			category: "General",
			execute: () => {},
		});
		expect(store.getShortcutForId("test.none")).toBeUndefined();
	});

	test("returns undefined for unknown action", () => {
		expect(useActionStore.getState().getShortcutForId("unknown")).toBeUndefined();
	});
});

describe("palette state", () => {
	beforeEach(resetStore);

	test("opens and closes palette", () => {
		useActionStore.getState().openPalette();
		expect(useActionStore.getState().isPaletteOpen).toBe(true);

		useActionStore.getState().closePalette();
		expect(useActionStore.getState().isPaletteOpen).toBe(false);
	});
});

describe("terminal shortcut guard", () => {
	test("skips plain printable keys when terminal is focused", () => {
		const terminalTarget = {
			tagName: "TEXTAREA",
			closest: (selector: string) => (selector === ".xterm" ? {} : null),
		} as HTMLElement;
		const event = {
			key: "a",
			metaKey: false,
			ctrlKey: false,
			altKey: false,
		} as KeyboardEvent;

		expect(shouldSkipShortcutHandling(event, terminalTarget)).toBe(true);
	});

	test("does not skip modified shortcuts in terminal focus", () => {
		const terminalTarget = {
			tagName: "TEXTAREA",
			closest: (selector: string) => (selector === ".xterm" ? {} : null),
		} as HTMLElement;

		expect(
			shouldSkipShortcutHandling(
				{ key: "k", metaKey: true, ctrlKey: false, altKey: false } as KeyboardEvent,
				terminalTarget
			)
		).toBe(false);
		expect(
			shouldSkipShortcutHandling(
				{ key: "k", metaKey: false, ctrlKey: true, altKey: false } as KeyboardEvent,
				terminalTarget
			)
		).toBe(false);
		expect(
			shouldSkipShortcutHandling(
				{ key: "k", metaKey: false, ctrlKey: false, altKey: true } as KeyboardEvent,
				terminalTarget
			)
		).toBe(false);
	});
});
