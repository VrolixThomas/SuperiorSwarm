import { describe, expect, test } from "bun:test";
import { clampBandHeight, computeBandLayout } from "../src/renderer/utils/sidebar-bands";

const present = { folders: true, repositories: true, orchestrators: true };
const open = { folders: true, repositories: true, orchestrators: true };
const noHeights = { folders: null, repositories: null, orchestrators: null };

function run(over: Partial<Parameters<typeof computeBandLayout>[0]> = {}) {
	return computeBandLayout({
		order: ["folders", "repositories", "orchestrators"],
		present,
		open,
		heights: noHeights,
		preferredFlex: "repositories",
		containerHeight: 1000,
		...over,
	});
}

describe("computeBandLayout", () => {
	test("preferred band flexes, other open auto bands are auto", () => {
		const l = run();
		expect(l.repositories.kind).toBe("flex");
		expect(l.folders.kind).toBe("auto");
		expect(l.orchestrators.kind).toBe("auto");
	});

	test("absent band is hidden", () => {
		const l = run({ present: { ...present, folders: false } });
		expect(l.folders.kind).toBe("hidden");
	});

	test("closed band is collapsed", () => {
		const l = run({ open: { ...open, orchestrators: false } });
		expect(l.orchestrators.kind).toBe("collapsed");
	});

	test("explicit height becomes a clamped fixed band", () => {
		const l = run({ heights: { ...noHeights, folders: 150 } });
		expect(l.folders).toEqual({ kind: "fixed", heightPx: 150 });
	});

	test("when preferred is closed, bottom-most open auto band flexes", () => {
		const l = run({ open: { ...open, repositories: false } });
		expect(l.repositories.kind).toBe("collapsed");
		expect(l.orchestrators.kind).toBe("flex");
		expect(l.folders.kind).toBe("auto");
	});

	test("when preferred has explicit height, it is fixed and another band flexes", () => {
		const l = run({ heights: { ...noHeights, repositories: 300 } });
		expect(l.repositories).toEqual({ kind: "fixed", heightPx: 300 });
		expect(l.orchestrators.kind).toBe("flex");
	});

	test("single open band flexes (focus on one)", () => {
		const l = run({ open: { folders: false, repositories: false, orchestrators: true } });
		expect(l.orchestrators.kind).toBe("flex");
	});
});

describe("clampBandHeight", () => {
	test("clamps below min to min", () => {
		expect(clampBandHeight(10, 1000)).toBe(80);
	});
	test("clamps above maxFraction to the cap", () => {
		expect(clampBandHeight(900, 1000)).toBe(600);
	});
	test("rounds values in range", () => {
		expect(clampBandHeight(200.4, 1000)).toBe(200);
	});
});
