import { describe, expect, test } from "bun:test";
import {
	getSearchEverywhereEmptyStateMessage,
	symbolKindGlyph,
} from "../src/renderer/components/SearchEverywherePopup";
import { type ResultItem, resultKey } from "../src/renderer/utils/search-everywhere-results";

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

	test("distinguishes text matches whose colon-bearing fields would join the same", () => {
		const first: ResultItem = {
			type: "text",
			path: "src/App.tsx",
			line: 2,
			text: "query:3:needle",
		};
		const second: ResultItem = {
			type: "text",
			path: "src/App.tsx:2:query",
			line: 3,
			text: "needle",
		};

		expect(resultKey(first)).not.toBe(resultKey(second));
	});

	test("distinguishes symbols whose colon-bearing fields would join the same", () => {
		const first: ResultItem = {
			type: "symbol",
			name: "render:default",
			kind: 12,
			path: "src/App.tsx",
			line: 42,
			column: 3,
		};
		const second: ResultItem = {
			type: "symbol",
			name: "render",
			kind: 12,
			path: "default:src/App.tsx",
			line: 42,
			column: 3,
		};

		expect(resultKey(first)).not.toBe(resultKey(second));
	});

	test("distinguishes symbols with the same location but different kind and container", () => {
		const first: ResultItem = {
			type: "symbol",
			name: "render",
			kind: 12,
			path: "src/App.tsx",
			line: 42,
			column: 3,
			container: "App",
		};
		const second: ResultItem = { ...first, kind: 13, container: "Layout" };

		expect(resultKey(first)).not.toBe(resultKey(second));
	});

	test("distinguishes omitted symbol container from an empty container", () => {
		const withoutContainer: ResultItem = {
			type: "symbol",
			name: "render",
			kind: 12,
			path: "src/App.tsx",
			line: 42,
			column: 3,
		};
		const withEmptyContainer: ResultItem = { ...withoutContainer, container: "" };

		expect(resultKey(withoutContainer)).not.toBe(resultKey(withEmptyContainer));
	});
});

describe("symbolKindGlyph", () => {
	test("returns LSP symbol kind glyphs with fallback", () => {
		expect(symbolKindGlyph(5)).toBe("C");
		expect(symbolKindGlyph(9)).toBe("⊕");
		expect(symbolKindGlyph(12)).toBe("F");
		expect(symbolKindGlyph(999)).toBe("•");
	});
});

describe("getSearchEverywhereEmptyStateMessage", () => {
	test("shows search failed for current symbols query errors", () => {
		expect(
			getSearchEverywhereEmptyStateMessage({
				activeTab: "symbols",
				trimmedQuery: "render",
				queryMatchesInput: true,
				isError: true,
				isFetching: false,
				serversQueried: undefined,
			})
		).toBe("Search failed");
	});

	test("shows no results for current symbols query when servers queried is unknown", () => {
		expect(
			getSearchEverywhereEmptyStateMessage({
				activeTab: "symbols",
				trimmedQuery: "render",
				queryMatchesInput: true,
				isError: false,
				isFetching: false,
				serversQueried: undefined,
			})
		).toBe("No results");
	});

	test("shows no-server hint only for current symbols query state", () => {
		expect(
			getSearchEverywhereEmptyStateMessage({
				activeTab: "symbols",
				trimmedQuery: "render",
				queryMatchesInput: true,
				isFetching: false,
				serversQueried: 0,
			})
		).toBe("No language servers running — symbols appear once files are opened in the editor");

		expect(
			getSearchEverywhereEmptyStateMessage({
				activeTab: "symbols",
				trimmedQuery: "renderer",
				queryMatchesInput: false,
				isFetching: false,
				serversQueried: 0,
			})
		).toBe("Searching...");
	});
});
