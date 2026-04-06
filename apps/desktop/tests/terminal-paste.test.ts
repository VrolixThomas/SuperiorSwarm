import { describe, expect, mock, test } from "bun:test";
import { hasImageOrFilePayload, interceptPaste } from "../src/renderer/components/terminal-paste";

function fakeDataTransfer(types: string[]): DataTransfer {
	return { types } as unknown as DataTransfer;
}

describe("hasImageOrFilePayload", () => {
	test("returns true for image types", () => {
		expect(hasImageOrFilePayload(fakeDataTransfer(["Files", "image/png"]))).toBe(true);
	});

	test("returns false for text-only", () => {
		expect(hasImageOrFilePayload(fakeDataTransfer(["text/plain"]))).toBe(false);
	});

	test("returns false for empty types", () => {
		expect(hasImageOrFilePayload(fakeDataTransfer([]))).toBe(false);
	});

	test("returns false for text/html without images", () => {
		expect(hasImageOrFilePayload(fakeDataTransfer(["text/plain", "text/html"]))).toBe(false);
	});

	test("returns true for Files type alone", () => {
		expect(hasImageOrFilePayload(fakeDataTransfer(["Files"]))).toBe(true);
	});

	test("returns true for image MIME type alone", () => {
		expect(hasImageOrFilePayload(fakeDataTransfer(["image/png"]))).toBe(true);
	});
});

function fakeClipboardEvent(
	text: string,
	types: string[]
): {
	event: ClipboardEvent;
	preventDefault: ReturnType<typeof mock>;
	stopImmediatePropagation: ReturnType<typeof mock>;
} {
	const preventDefault = mock(() => {});
	const stopImmediatePropagation = mock(() => {});
	const event = {
		clipboardData: {
			getData: mock((type: string) => (type === "text/plain" ? text : "")),
			types,
		},
		preventDefault,
		stopImmediatePropagation,
	} as unknown as ClipboardEvent;
	return { event, preventDefault, stopImmediatePropagation };
}

type PasteListener = (event: ClipboardEvent) => void;

function fakeXterm(): {
	term: { textarea: HTMLTextAreaElement | null; paste: ReturnType<typeof mock> };
	getListener: () => PasteListener | undefined;
} {
	const listeners = new Map<string, EventListener>();
	const textarea = {
		addEventListener: mock((type: string, listener: EventListener) => {
			listeners.set(type, listener);
		}),
		removeEventListener: mock((type: string) => {
			listeners.delete(type);
		}),
	} as unknown as HTMLTextAreaElement;
	const paste = mock(() => {});
	return {
		term: { textarea, paste },
		getListener: () => listeners.get("paste") as PasteListener | undefined,
	};
}

describe("interceptPaste", () => {
	test("forwards Ctrl+V for image-only clipboard", () => {
		const { term, getListener } = fakeXterm();
		const writeToPty = mock(() => {});
		interceptPaste(term as any, writeToPty);

		const { event, preventDefault, stopImmediatePropagation } = fakeClipboardEvent("", [
			"Files",
			"image/png",
		]);
		getListener()!(event);

		expect(writeToPty).toHaveBeenCalledWith("\x16");
		expect(preventDefault).toHaveBeenCalled();
		expect(stopImmediatePropagation).toHaveBeenCalled();
		expect(term.paste).not.toHaveBeenCalled();
	});

	test("pastes text for text-only clipboard", () => {
		const { term, getListener } = fakeXterm();
		const writeToPty = mock(() => {});
		interceptPaste(term as any, writeToPty);

		const { event, preventDefault, stopImmediatePropagation } = fakeClipboardEvent("hello world", [
			"text/plain",
		]);
		getListener()!(event);

		expect(term.paste).toHaveBeenCalledWith("hello world");
		expect(preventDefault).toHaveBeenCalled();
		expect(stopImmediatePropagation).toHaveBeenCalled();
		expect(writeToPty).not.toHaveBeenCalled();
	});

	test("does nothing for empty clipboard", () => {
		const { term, getListener } = fakeXterm();
		const writeToPty = mock(() => {});
		interceptPaste(term as any, writeToPty);

		const { event, preventDefault } = fakeClipboardEvent("", []);
		getListener()!(event);

		expect(writeToPty).not.toHaveBeenCalled();
		expect(term.paste).not.toHaveBeenCalled();
		expect(preventDefault).not.toHaveBeenCalled();
	});

	test("pastes text when clipboard has mixed types including text", () => {
		const { term, getListener } = fakeXterm();
		const writeToPty = mock(() => {});
		interceptPaste(term as any, writeToPty);

		const { event } = fakeClipboardEvent("some text", ["text/plain", "text/html"]);
		getListener()!(event);

		expect(term.paste).toHaveBeenCalledWith("some text");
		expect(writeToPty).not.toHaveBeenCalled();
	});

	test("returns no-op cleanup when textarea is null", () => {
		const term = { textarea: null, paste: mock(() => {}) };
		const writeToPty = mock(() => {});
		const cleanup = interceptPaste(term as any, writeToPty);

		expect(typeof cleanup).toBe("function");
		cleanup(); // should not throw
	});

	test("cleanup removes the paste listener", () => {
		const { term, getListener } = fakeXterm();
		const writeToPty = mock(() => {});
		const cleanup = interceptPaste(term as any, writeToPty);

		expect(getListener()).toBeDefined();
		cleanup();
		expect(getListener()).toBeUndefined();
	});
});
