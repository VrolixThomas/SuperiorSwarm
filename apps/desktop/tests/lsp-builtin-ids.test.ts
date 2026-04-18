import { describe, expect, test } from "bun:test";
import { DEFAULT_SERVER_CONFIGS } from "../src/main/lsp/registry";
import { BUILT_IN_SERVER_DISPLAY, BUILT_IN_SERVER_IDS } from "../src/shared/lsp-builtin-ids";

describe("built-in server id list", () => {
	test("matches DEFAULT_SERVER_CONFIGS ids exactly", () => {
		const fromRegistry = DEFAULT_SERVER_CONFIGS.map((c) => c.id).sort();
		const fromList = [...BUILT_IN_SERVER_IDS].sort();
		expect(fromList).toEqual(fromRegistry);
	});

	test("every built-in has a display name", () => {
		for (const id of BUILT_IN_SERVER_IDS) {
			expect(BUILT_IN_SERVER_DISPLAY[id]).toBeTruthy();
		}
	});
});
