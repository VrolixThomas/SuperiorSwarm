import { describe, expect, test } from "bun:test";
import { resolveTheme } from "../src/renderer/lib/theme";

describe("resolveTheme", () => {
	test("system + dark OS → dark", () => {
		expect(resolveTheme("system", true)).toBe("dark");
	});

	test("system + light OS → light", () => {
		expect(resolveTheme("system", false)).toBe("light");
	});

	test("explicit light overrides OS dark", () => {
		expect(resolveTheme("light", true)).toBe("light");
	});

	test("explicit dark overrides OS light", () => {
		expect(resolveTheme("dark", false)).toBe("dark");
	});
});
