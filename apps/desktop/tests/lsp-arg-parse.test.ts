import { describe, expect, test } from "bun:test";
import { parseArgs, stringifyArgs } from "../src/renderer/lsp/arg-parse";

describe("parseArgs", () => {
	test("splits simple whitespace", () => {
		expect(parseArgs("--stdio --verbose")).toEqual(["--stdio", "--verbose"]);
	});

	test("preserves quoted strings with spaces", () => {
		expect(parseArgs(`--init '{"key":"value with space"}'`)).toEqual([
			"--init",
			`{"key":"value with space"}`,
		]);
	});

	test("handles empty string", () => {
		expect(parseArgs("")).toEqual([]);
	});

	test("handles only whitespace", () => {
		expect(parseArgs("   \t  ")).toEqual([]);
	});

	test("roundtrip through stringify", () => {
		const args = ["--init", `{"k":"v w"}`, "--foo"];
		expect(parseArgs(stringifyArgs(args))).toEqual(args);
	});
});
