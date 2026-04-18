import { describe, expect, test } from "bun:test";
import { detectConflicts } from "../src/renderer/components/settings/lsp/conflicts";
import type { LanguageServerConfig } from "../src/shared/lsp-schema";

function cfg(id: string, overrides: Partial<LanguageServerConfig> = {}): LanguageServerConfig {
	return {
		id,
		command: `${id}-ls`,
		args: [],
		languages: [],
		fileExtensions: [],
		fileNames: [],
		rootMarkers: [".git"],
		disabled: false,
		...overrides,
	};
}

describe("detectConflicts", () => {
	test("returns no conflicts for non-overlapping servers", () => {
		const result = detectConflicts([
			cfg("python", { fileExtensions: [".py"] }),
			cfg("go", { fileExtensions: [".go"] }),
		]);
		expect(result.size).toBe(0);
	});

	test("flags second server as overlapping when extensions collide", () => {
		const result = detectConflicts([
			cfg("typescript", { fileExtensions: [".ts"] }),
			cfg("deno", { fileExtensions: [".ts"] }),
		]);

		expect(result.get("typescript")).toBeUndefined();
		expect(result.get("deno")?.overlappingWith).toEqual(["typescript"]);
	});

	test("flags second server as overlapping when languages collide", () => {
		const result = detectConflicts([
			cfg("first", { languages: ["python"] }),
			cfg("second", { languages: ["python"] }),
		]);
		expect(result.get("second")?.overlappingWith).toEqual(["first"]);
	});

	test("flags when fileNames collide", () => {
		const result = detectConflicts([
			cfg("dockerA", { fileNames: ["Dockerfile"] }),
			cfg("dockerB", { fileNames: ["Dockerfile"] }),
		]);
		expect(result.get("dockerB")?.overlappingWith).toEqual(["dockerA"]);
	});

	test("skips disabled servers for conflict detection", () => {
		const result = detectConflicts([
			cfg("a", { fileExtensions: [".x"], disabled: true }),
			cfg("b", { fileExtensions: [".x"] }),
		]);
		expect(result.size).toBe(0);
	});

	test("aggregates multiple earlier overlaps", () => {
		const result = detectConflicts([
			cfg("a", { fileExtensions: [".x"] }),
			cfg("b", { fileExtensions: [".x"] }),
			cfg("c", { fileExtensions: [".x"] }),
		]);
		// c overlaps with a and b (both earlier)
		expect(result.get("c")?.overlappingWith).toEqual(["a", "b"]);
	});
});
