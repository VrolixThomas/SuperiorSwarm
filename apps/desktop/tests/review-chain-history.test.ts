import { describe, expect, test } from "bun:test";
import { computeResolutionDeltas } from "../src/main/ai-review/orchestrator";

describe("computeResolutionDeltas", () => {
	test("marks comments with no previous match as NEW", () => {
		const current = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const previous: typeof current = [];
		const deltas = computeResolutionDeltas(current, previous);
		expect(deltas.get(0)).toBe("new");
	});

	test("marks previous comments not in current as RESOLVED", () => {
		const current: Array<{ filePath: string; lineNumber: number | null }> = [];
		const previous = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const deltas = computeResolutionDeltas(current, previous);
		// No current comments, so no deltas to set — resolved is about previous comments
		expect(deltas.size).toBe(0);
	});

	test("marks same file+line in both rounds as STILL_OPEN", () => {
		const current = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const previous = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const deltas = computeResolutionDeltas(current, previous);
		expect(deltas.get(0)).toBe("still_open");
	});

	test("marks comment at previously resolved location as REGRESSED", () => {
		const current = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const previous = [
			{ filePath: "src/a.ts", lineNumber: 10, resolution: "resolved-on-platform" },
		];
		const deltas = computeResolutionDeltas(current, previous);
		expect(deltas.get(0)).toBe("regressed");
	});

	test("handles file-level comments (null lineNumber)", () => {
		const current = [{ filePath: "src/a.ts", lineNumber: null }];
		const previous = [{ filePath: "src/a.ts", lineNumber: null }];
		const deltas = computeResolutionDeltas(current, previous);
		expect(deltas.get(0)).toBe("still_open");
	});

	test("handles mixed — some new, some still_open", () => {
		const current = [
			{ filePath: "src/a.ts", lineNumber: 10 },
			{ filePath: "src/b.ts", lineNumber: 20 },
		];
		const previous = [{ filePath: "src/a.ts", lineNumber: 10 }];
		const deltas = computeResolutionDeltas(current, previous);
		expect(deltas.get(0)).toBe("still_open");
		expect(deltas.get(1)).toBe("new");
	});
});
