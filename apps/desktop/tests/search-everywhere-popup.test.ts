import { describe, expect, test } from "bun:test";
import { type ResultItem, resultKey } from "../src/renderer/components/SearchEverywherePopup";

describe("resultKey", () => {
	test("distinguishes symbols on the same file and line by column", () => {
		const first: ResultItem = {
			type: "symbol",
			name: "render",
			kind: 12,
			path: "src/App.tsx",
			line: 42,
			column: 3,
		};
		const second: ResultItem = { ...first, column: 18 };

		expect(resultKey(first)).not.toBe(resultKey(second));
	});

	test("distinguishes text matches on the same file and line by text", () => {
		const first: ResultItem = {
			type: "text",
			path: "src/App.tsx",
			line: 42,
			text: "const isOpen = true;",
		};
		const second: ResultItem = { ...first, text: "const isOpen = false;" };

		expect(resultKey(first)).not.toBe(resultKey(second));
	});
});
