import { describe, expect, test } from "bun:test";
import { BEAT_COPY_V3, type CopyKeyV3 } from "../src/hero/build-v3/beat-copy";

describe("beat copy v3", () => {
	test("contains opener, six beats, before/after, no voiceover field", () => {
		const keys = BEAT_COPY_V3.map((b) => b.key);
		expect(keys).toEqual([
			"open",
			"tickets",
			"workspace",
			"worktrees",
			"splitPane",
			"prReview",
			"solve",
			"beforeAfter",
		] as CopyKeyV3[]);
		for (const b of BEAT_COPY_V3) {
			expect(b).not.toHaveProperty("voiceover");
			expect(typeof b.caption).toBe("string");
			expect(typeof b.startFrame).toBe("number");
		}
	});

	test("caption start frames are monotonic", () => {
		const starts = BEAT_COPY_V3.map((b) => b.startFrame);
		for (let i = 1; i < starts.length; i++) {
			expect(starts[i]).toBeGreaterThan(starts[i - 1]!);
		}
	});
});
