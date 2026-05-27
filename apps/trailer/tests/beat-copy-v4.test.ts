import { describe, expect, test } from "bun:test";
import { BEAT_COPY_V4 } from "../src/hero/build-v4/beat-copy";
import { SCENES_V4, TOTAL_FRAMES_V4 } from "../src/hero/build-v4/timeline";

describe("beat-copy-v4", () => {
	test("has one entry per primary scene (outro renders its own CTA, no caption)", () => {
		expect(BEAT_COPY_V4.length).toBe(12);
	});

	test("every startFrame is within total range", () => {
		for (const e of BEAT_COPY_V4) {
			expect(e.startFrame).toBeGreaterThanOrEqual(0);
			expect(e.startFrame).toBeLessThan(TOTAL_FRAMES_V4);
		}
	});

	test("startFrames are strictly increasing", () => {
		for (let i = 1; i < BEAT_COPY_V4.length; i++) {
			const prev = BEAT_COPY_V4[i - 1];
			const cur = BEAT_COPY_V4[i];
			if (!prev || !cur) throw new Error("beat copy malformed");
			expect(cur.startFrame).toBeGreaterThan(prev.startFrame);
		}
	});

	test("every caption is non-empty", () => {
		for (const e of BEAT_COPY_V4) {
			expect(e.caption.length).toBeGreaterThan(0);
		}
	});

	test("first entry starts near opening end", () => {
		const first = BEAT_COPY_V4[0];
		expect(first?.startFrame).toBeLessThan(SCENES_V4.s1Terminal.from + 60);
	});
});
