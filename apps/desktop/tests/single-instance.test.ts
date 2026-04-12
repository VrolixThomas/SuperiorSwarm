import { describe, expect, test } from "bun:test";
import { handleSecondInstance } from "../src/main/single-instance";

describe("handleSecondInstance", () => {
	test("returns false when no window is available", () => {
		expect(handleSecondInstance(null)).toBe(false);
	});

	test("restores minimized window and focuses it", () => {
		let restored = false;
		let focused = false;
		const win = {
			isDestroyed: () => false,
			isMinimized: () => true,
			restore: () => {
				restored = true;
			},
			focus: () => {
				focused = true;
			},
		};

		expect(handleSecondInstance(win as never)).toBe(true);
		expect(restored).toBe(true);
		expect(focused).toBe(true);
	});

	test("returns false when window is destroyed", () => {
		let restored = false;
		let focused = false;
		const win = {
			isDestroyed: () => true,
			isMinimized: () => true,
			restore: () => {
				restored = true;
			},
			focus: () => {
				focused = true;
			},
		};

		expect(handleSecondInstance(win as never)).toBe(false);
		expect(restored).toBe(false);
		expect(focused).toBe(false);
	});
});
