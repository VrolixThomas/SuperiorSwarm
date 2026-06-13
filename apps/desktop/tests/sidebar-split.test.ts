import { describe, expect, test } from "bun:test";
import { clampPaneHeight } from "../src/renderer/utils/sidebar-split";

describe("clampPaneHeight", () => {
	test("returns a value within range unchanged (rounded)", () => {
		expect(clampPaneHeight(200.4, 800)).toBe(200);
	});

	test("clamps below the minimum", () => {
		expect(clampPaneHeight(10, 800, { min: 80 })).toBe(80);
	});

	test("clamps above the max fraction of the container", () => {
		// max = floor(800 * 0.6) = 480
		expect(clampPaneHeight(900, 800, { maxFraction: 0.6 })).toBe(480);
	});

	test("when container is tiny, min wins over max", () => {
		// max would be floor(100 * 0.6) = 60, but min is 80 -> 80
		expect(clampPaneHeight(50, 100, { min: 80, maxFraction: 0.6 })).toBe(80);
	});
});
