import { describe, expect, test } from "bun:test";
import {
	normalizeBranchNameInput,
	splitBranchPrefix,
} from "../src/renderer/utils/branch-name";

describe("normalizeBranchNameInput", () => {
	test("replaces typed spaces with hyphens", () => {
		expect(normalizeBranchNameInput("fix branch name")).toBe("fix-branch-name");
	});

	test("replaces every space in pasted input", () => {
		expect(normalizeBranchNameInput("feature/with  two spaces")).toBe(
			"feature/with--two-spaces"
		);
	});

	test("leaves branch names without spaces unchanged", () => {
		expect(normalizeBranchNameInput("feature/already-valid")).toBe("feature/already-valid");
	});
});

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
