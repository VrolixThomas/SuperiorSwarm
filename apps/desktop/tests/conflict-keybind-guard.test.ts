import { describe, expect, it } from "bun:test";
import { shouldSkipShortcutHandling } from "../src/renderer/hooks/useShortcutListener";

describe("shouldSkipShortcutHandling", () => {
	function makeEvent(key: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
		return { key, metaKey: false, ctrlKey: false, altKey: false, ...modifiers } as KeyboardEvent;
	}

	function makeElement(overrides: Partial<HTMLElement> = {}): HTMLElement {
		return {
			tagName: "DIV",
			isContentEditable: false,
			closest: () => null,
			classList: { contains: () => false },
			...overrides,
		} as unknown as HTMLElement;
	}

	it("skips plain keys when target is inside .xterm", () => {
		const el = makeElement({ closest: (sel: string) => (sel === ".xterm" ? {} : null) } as any);
		expect(shouldSkipShortcutHandling(makeEvent("j"), el)).toBe(true);
		expect(shouldSkipShortcutHandling(makeEvent("t"), el)).toBe(true);
	});

	it("allows modifier keys through xterm", () => {
		const el = makeElement({ closest: (sel: string) => (sel === ".xterm" ? {} : null) } as any);
		expect(shouldSkipShortcutHandling(makeEvent("z", { metaKey: true }), el)).toBe(false);
	});

	it("skips plain keys in text inputs", () => {
		const el = makeElement({ tagName: "INPUT" });
		expect(shouldSkipShortcutHandling(makeEvent("j"), el)).toBe(true);
	});

	it("allows plain keys on normal div targets", () => {
		const el = makeElement();
		expect(shouldSkipShortcutHandling(makeEvent("j"), el)).toBe(false);
	});
});
