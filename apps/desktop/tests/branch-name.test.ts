import { describe, expect, test } from "bun:test";
import { splitBranchPrefix } from "../src/renderer/utils/branch-name";

describe("splitBranchPrefix", () => {
	test("splits a feature branch into prefix + rest", () => {
		expect(splitBranchPrefix("feature/PI-3040-ezugi-wallet")).toEqual({
			prefix: "feature/",
			rest: "PI-3040-ezugi-wallet",
		});
	});

	test("no slash means empty prefix", () => {
		expect(splitBranchPrefix("main")).toEqual({ prefix: "", rest: "main" });
	});

	test("keeps everything up to the last slash in the prefix", () => {
		expect(splitBranchPrefix("a/b/c")).toEqual({ prefix: "a/b/", rest: "c" });
	});

	test("trailing slash yields empty rest", () => {
		expect(splitBranchPrefix("feat/")).toEqual({ prefix: "feat/", rest: "" });
	});

	test("empty string", () => {
		expect(splitBranchPrefix("")).toEqual({ prefix: "", rest: "" });
	});
});
