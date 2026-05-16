import { describe, expect, test } from "bun:test";
import { FPS_V4, SCENES_V4, TOTAL_FRAMES_V4 } from "../src/hero/build-v4/timeline";

describe("timeline-v4", () => {
	test("fps is 60", () => {
		expect(FPS_V4).toBe(60);
	});

	test("total frames matches sum of scene durations", () => {
		const sum = Object.values(SCENES_V4).reduce((acc, s) => acc + s.duration, 0);
		expect(sum).toBe(TOTAL_FRAMES_V4);
		expect(TOTAL_FRAMES_V4).toBe(4980);
	});

	test("scenes are contiguous, no gaps no overlaps", () => {
		const entries = Object.values(SCENES_V4);
		for (let i = 1; i < entries.length; i++) {
			const prev = entries[i - 1];
			const cur = entries[i];
			if (!prev || !cur) throw new Error("scene table malformed");
			expect(cur.from).toBe(prev.from + prev.duration);
		}
	});

	test("all from values are non-negative integers", () => {
		for (const s of Object.values(SCENES_V4)) {
			expect(Number.isInteger(s.from)).toBe(true);
			expect(s.from).toBeGreaterThanOrEqual(0);
			expect(Number.isInteger(s.duration)).toBe(true);
			expect(s.duration).toBeGreaterThan(0);
		}
	});

	test("first scene starts at 0", () => {
		const first = Object.values(SCENES_V4)[0];
		expect(first?.from).toBe(0);
	});
});
