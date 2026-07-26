import { describe, expect, test } from "bun:test";
import { hasSubmitPayload } from "../src/renderer/lib/pr-review-submit";

describe("hasSubmitPayload", () => {
	test("false for zero accepted, COMMENT verdict, empty body", () => {
		expect(hasSubmitPayload(0, "COMMENT", "")).toBe(false);
		expect(hasSubmitPayload(0, "COMMENT", "   ")).toBe(false);
	});

	test("true when anything would actually be sent", () => {
		expect(hasSubmitPayload(1, "COMMENT", "")).toBe(true);
		expect(hasSubmitPayload(0, "APPROVE", "")).toBe(true);
		expect(hasSubmitPayload(0, "REQUEST_CHANGES", "")).toBe(true);
		expect(hasSubmitPayload(0, "COMMENT", "lgtm")).toBe(true);
	});
});
