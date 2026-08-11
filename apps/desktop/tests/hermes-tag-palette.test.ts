import { describe, expect, test } from "bun:test";
import { HERMES_TAG_COLORS } from "../src/shared/hermes";

interface Rgb {
	r: number;
	g: number;
	b: number;
}

function hex(value: string): Rgb {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
	if (!match) throw new Error(`Invalid hex color ${value}`);
	return {
		r: Number.parseInt(match[1] ?? "", 16),
		g: Number.parseInt(match[2] ?? "", 16),
		b: Number.parseInt(match[3] ?? "", 16),
	};
}

function composite(value: string, surface: Rgb): Rgb {
	const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
	if (!match) return hex(value);
	const alpha = Number(match[4]);
	return {
		r: Number(match[1]) * alpha + surface.r * (1 - alpha),
		g: Number(match[2]) * alpha + surface.g * (1 - alpha),
		b: Number(match[3]) * alpha + surface.b * (1 - alpha),
	};
}

function luminance(color: Rgb): number {
	const channels = [color.r, color.g, color.b].map((channel) => {
		const normalized = channel / 255;
		return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrast(left: Rgb, right: Rgb): number {
	const first = luminance(left);
	const second = luminance(right);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function values(source: string, variable: string): string[] {
	return Array.from(source.matchAll(new RegExp(`--${variable}:\\s*([^;]+);`, "g"))).map(
		(match) => match[1]?.trim() ?? ""
	);
}

describe("Hermes accessible tag palette", () => {
	test("defines foreground, tint, and border tokens in dark and light themes with readable text", async () => {
		const css = await Bun.file(new URL("../src/renderer/styles.css", import.meta.url)).text();
		const surfaces: readonly [Rgb, Rgb] = [hex("#1f1f22"), hex("#ffffff")];
		for (const color of HERMES_TAG_COLORS) {
			const foregrounds = values(css, `tag-${color}-fg`);
			const backgrounds = values(css, `tag-${color}-bg`);
			const borders = values(css, `tag-${color}-border`);
			expect(foregrounds).toHaveLength(2);
			expect(backgrounds).toHaveLength(2);
			expect(borders).toHaveLength(2);
			for (const themeIndex of [0, 1] as const) {
				const foreground = hex(foregrounds[themeIndex] ?? "");
				const background = composite(backgrounds[themeIndex] ?? "", surfaces[themeIndex]);
				expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	test("maps every domain token to reusable chip classes and keeps the row at two lines", async () => {
		const chips = await Bun.file(
			new URL("../src/renderer/components/hermes/HermesTagChip.tsx", import.meta.url)
		).text();
		const row = await Bun.file(
			new URL("../src/renderer/components/hermes/HermesSessionRow.tsx", import.meta.url)
		).text();
		for (const color of HERMES_TAG_COLORS) {
			expect(chips).toContain(`var(--tag-${color}-fg)`);
			expect(chips).toContain(`var(--tag-${color}-bg)`);
			expect(chips).toContain(`var(--tag-${color}-border)`);
		}
		expect(row).toContain('className="h-[56px]');
		expect(row).toContain("session.tags.slice(0, 2)");
		expect(row.split("\n").length).toBeLessThan(220);
		expect(row).toContain("HermesSessionActionsPopover");
		expect(row).not.toContain('onListTagDefinitions("")');
	});
});
