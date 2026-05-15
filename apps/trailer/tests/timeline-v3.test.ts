import { describe, expect, test } from "bun:test";
import {
	ACTS_V3,
	BEATS_V3,
	BEAT_KEYS_V3,
	FPS_V3,
	TOTAL_FRAMES_V3,
	beatStartAbsV3,
} from "../src/hero/build-v3/timeline";

describe("timeline v3", () => {
	test("60s @ 60fps", () => {
		expect(FPS_V3).toBe(60);
		expect(TOTAL_FRAMES_V3).toBe(3600);
	});

	test("acts cover full duration without gaps or overlaps", () => {
		const acts = [
			ACTS_V3.calm,
			ACTS_V3.multiply,
			ACTS_V3.collapse,
			ACTS_V3.build,
			ACTS_V3.beforeAfter,
			ACTS_V3.reveal,
		];
		let cursor = 0;
		for (const a of acts) {
			expect(a.from).toBe(cursor);
			cursor += a.durationInFrames;
		}
		expect(cursor).toBe(TOTAL_FRAMES_V3);
	});

	test("six beats, each 300 frames", () => {
		expect(BEAT_KEYS_V3).toHaveLength(6);
		for (const k of BEAT_KEYS_V3) {
			expect(BEATS_V3[k].durationInFrames).toBe(300);
		}
	});

	test("beats are contiguous and fill build act", () => {
		const buildStart = ACTS_V3.build.from;
		const buildEnd = buildStart + ACTS_V3.build.durationInFrames;
		expect(beatStartAbsV3("tickets")).toBe(buildStart);
		expect(beatStartAbsV3("solve") + BEATS_V3.solve.durationInFrames).toBe(buildEnd);
	});
});
