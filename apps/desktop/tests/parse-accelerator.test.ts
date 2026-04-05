import { describe, expect, test } from "bun:test";
import { parseAccelerator } from "../src/renderer/utils/parse-accelerator";

describe("parseAccelerator", () => {
	test("parses CommandOrControl+Shift+B", () => {
		const result = parseAccelerator("CommandOrControl+Shift+B");
		expect(result).toEqual({ key: "b", meta: true, shift: true });
	});

	test("parses CommandOrControl+K", () => {
		const result = parseAccelerator("CommandOrControl+K");
		expect(result).toEqual({ key: "k", meta: true });
	});

	test("parses Alt+Shift+T", () => {
		const result = parseAccelerator("Alt+Shift+T");
		expect(result).toEqual({ key: "t", shift: true, alt: true });
	});

	test("parses CommandOrControl+Enter", () => {
		const result = parseAccelerator("CommandOrControl+Enter");
		expect(result).toEqual({ key: "Enter", meta: true });
	});

	test("parses single key F5", () => {
		const result = parseAccelerator("F5");
		expect(result).toEqual({ key: "F5" });
	});

	test("returns null for empty string", () => {
		expect(parseAccelerator("")).toBeNull();
	});

	test("returns null for null input", () => {
		expect(parseAccelerator(null)).toBeNull();
	});

	test("parses Cmd+Shift+1", () => {
		const result = parseAccelerator("CommandOrControl+Shift+1");
		expect(result).toEqual({ key: "1", meta: true, shift: true });
	});
});
