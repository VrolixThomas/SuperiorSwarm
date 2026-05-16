import { describe, expect, test } from "bun:test";
import { C_V4 } from "../src/hero/build-v4/colors-v4";

describe("colors-v4", () => {
	test("exports dark and light palettes", () => {
		expect(C_V4.dark).toBeDefined();
		expect(C_V4.light).toBeDefined();
	});

	test("palettes have matching keys", () => {
		const darkKeys = Object.keys(C_V4.dark).sort();
		const lightKeys = Object.keys(C_V4.light).sort();
		expect(darkKeys).toEqual(lightKeys);
	});

	test("dark bgBase is darker than light bgBase", () => {
		expect(C_V4.dark.bgBase).toBe("#0a0a0a");
		expect(C_V4.light.bgBase).toBe("#fafaf7");
	});
});
