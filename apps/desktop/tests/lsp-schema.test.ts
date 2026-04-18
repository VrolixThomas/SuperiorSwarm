import { describe, expect, test } from "bun:test";
import { languageServerConfigSchema } from "../src/shared/lsp-schema";

const base = {
	command: "some-lsp",
	args: [],
	languages: ["foo"],
	fileExtensions: [".foo"],
	fileNames: [],
	rootMarkers: [".git"],
	disabled: false,
};

describe("languageServerConfigSchema id validation", () => {
	test("accepts lowercase ids", () => {
		const result = languageServerConfigSchema.safeParse({ ...base, id: "foo" });
		expect(result.success).toBe(true);
	});

	test("accepts kebab-case ids", () => {
		const result = languageServerConfigSchema.safeParse({ ...base, id: "my-lang" });
		expect(result.success).toBe(true);
	});

	test("accepts ids with digits after first char", () => {
		const result = languageServerConfigSchema.safeParse({ ...base, id: "py3-lang" });
		expect(result.success).toBe(true);
	});

	test("rejects empty id", () => {
		const result = languageServerConfigSchema.safeParse({ ...base, id: "" });
		expect(result.success).toBe(false);
	});

	test("rejects ids starting with a digit", () => {
		const result = languageServerConfigSchema.safeParse({ ...base, id: "3go" });
		expect(result.success).toBe(false);
	});

	test("rejects ids with uppercase letters", () => {
		const result = languageServerConfigSchema.safeParse({ ...base, id: "MyServer" });
		expect(result.success).toBe(false);
	});

	test("rejects ids with spaces", () => {
		const result = languageServerConfigSchema.safeParse({ ...base, id: "my server" });
		expect(result.success).toBe(false);
	});

	test("rejects ids with disallowed punctuation", () => {
		const result = languageServerConfigSchema.safeParse({ ...base, id: "my_server" });
		expect(result.success).toBe(false);
	});

	test("rejects overly long ids", () => {
		const result = languageServerConfigSchema.safeParse({ ...base, id: "a".repeat(50) });
		expect(result.success).toBe(false);
	});
});

describe("languageServerConfigSchema legacy fields", () => {
	test("silently drops legacy installHint field from old configs", () => {
		const result = languageServerConfigSchema.safeParse({
			...base,
			id: "foo",
			installHint: "brew install foo",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect("installHint" in result.data).toBe(false);
		}
	});

	test("silently drops legacy installHints array from old configs", () => {
		const result = languageServerConfigSchema.safeParse({
			...base,
			id: "foo",
			installHints: [{ manager: "brew", command: "brew install foo" }],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect("installHints" in result.data).toBe(false);
		}
	});
});
