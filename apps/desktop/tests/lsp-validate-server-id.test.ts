import { describe, expect, test } from "bun:test";
import { validateServerId } from "../src/renderer/components/settings/lsp/validate-server-id";

const empty = { existingIds: new Set<string>(), builtInIds: new Set<string>() };

describe("validateServerId", () => {
	test("returns ok for valid kebab-case id", () => {
		const r = validateServerId("my-lang", empty);
		expect(r.error).toBeNull();
		expect(r.warning).toBeNull();
	});

	test("returns error for empty id", () => {
		expect(validateServerId("", empty).error).toMatch(/required|must/i);
	});

	test("returns error for whitespace-only id", () => {
		expect(validateServerId("   ", empty).error).toBeTruthy();
	});

	test("returns error for id starting with digit", () => {
		expect(validateServerId("3go", empty).error).toBeTruthy();
	});

	test("returns error for uppercase id", () => {
		expect(validateServerId("MyServer", empty).error).toBeTruthy();
	});

	test("returns error for id with underscore", () => {
		expect(validateServerId("my_server", empty).error).toBeTruthy();
	});

	test("returns warning (not error) when id matches a built-in", () => {
		const r = validateServerId("typescript", {
			existingIds: new Set(),
			builtInIds: new Set(["typescript", "python"]),
		});
		expect(r.error).toBeNull();
		expect(r.warning).toMatch(/override|built-in/i);
	});

	test("returns error for id colliding with existing additional server", () => {
		const r = validateServerId("foo-lang", {
			existingIds: new Set(["foo-lang"]),
			builtInIds: new Set(),
		});
		expect(r.error).toMatch(/already|in use|exists/i);
	});

	test("allows id when it matches one being edited (skipCollisionCheck)", () => {
		const r = validateServerId(
			"foo-lang",
			{
				existingIds: new Set(["foo-lang"]),
				builtInIds: new Set(),
			},
			{ skipCollisionCheck: true }
		);
		expect(r.error).toBeNull();
	});

	test("built-in warning respects skipCollisionCheck when editing", () => {
		const r = validateServerId(
			"typescript",
			{
				existingIds: new Set(),
				builtInIds: new Set(["typescript"]),
			},
			{ skipCollisionCheck: true }
		);
		expect(r.error).toBeNull();
		expect(r.warning).toBeNull();
	});
});
