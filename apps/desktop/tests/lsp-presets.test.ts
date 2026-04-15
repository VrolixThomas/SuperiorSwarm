import { describe, expect, test } from "bun:test";
import { LSP_PRESETS, type LspPreset } from "../src/main/lsp/presets";
import { DEFAULT_SERVER_CONFIGS } from "../src/main/lsp/registry";

describe("LSP_PRESETS", () => {
	test("exports a non-empty array of presets", () => {
		expect(Array.isArray(LSP_PRESETS)).toBe(true);
		expect(LSP_PRESETS.length).toBeGreaterThan(0);
	});

	test("every preset has required fields", () => {
		for (const preset of LSP_PRESETS) {
			expect(preset.id).toBeTruthy();
			expect(preset.displayName).toBeTruthy();
			expect(preset.description).toBeTruthy();
			expect(preset.config.command).toBeTruthy();
			expect(preset.config.languages.length).toBeGreaterThan(0);
			expect(
				preset.config.fileExtensions.length + (preset.config.fileNames?.length ?? 0)
			).toBeGreaterThan(0);
		}
	});

	test("preset IDs are unique", () => {
		const ids = LSP_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("does not duplicate built-in default IDs", () => {
		const defaultIds = new Set(DEFAULT_SERVER_CONFIGS.map((c) => c.id));
		for (const preset of LSP_PRESETS) {
			expect(defaultIds.has(preset.id)).toBe(false);
		}
	});

	test("includes C# preset", () => {
		const csharp = LSP_PRESETS.find((p) => p.id === "csharp");
		expect(csharp).toBeDefined();
		expect(csharp!.config.command).toBe("csharp-ls");
		expect(csharp!.config.fileExtensions).toContain(".cs");
	});
});
