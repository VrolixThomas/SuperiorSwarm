import { describe, expect, test } from "bun:test";
import { filterAndSortBranches } from "../src/renderer/utils/branch-search";

const rank = (query: string, branches: string[]) =>
	filterAndSortBranches(branches, query, (branch) => branch);

describe("filterAndSortBranches", () => {
	test("puts an exact branch name ahead of branches that merely contain it", () => {
		const branches = ["fix-device", "feature/dev", "development", "dev-tools", "dev"];

		expect(rank("dev", branches)).toEqual([
			"dev",
			"feature/dev",
			"dev-tools",
			"development",
			"fix-device",
		]);
	});

	test("ranks exact and prefix segment matches ahead of incidental substrings", () => {
		const branches = ["feature/authentication", "fix/author", "release/oauth", "topic/auth"];

		expect(rank("auth", branches)).toEqual([
			"topic/auth",
			"fix/author",
			"feature/authentication",
			"release/oauth",
		]);
	});

	test("supports compact fuzzy subsequence matches", () => {
		expect(rank("dev", ["d-x-e-x-v", "dxxxxxxd-e-v", "unrelated"])).toEqual([
			"dxxxxxxd-e-v",
			"d-x-e-x-v",
		]);
	});

	test("is case-insensitive and trims the query", () => {
		expect(rank("  DEV ", ["feature/dev", "Dev", "development"])).toEqual([
			"Dev",
			"feature/dev",
			"development",
		]);
	});

	test("retains the existing order for an empty query", () => {
		const branches = ["main", "dev", "feature/one"];
		expect(rank("   ", branches)).toEqual(branches);
	});

	test("supports branch objects without mutating the source list", () => {
		const branches = [{ name: "development" }, { name: "dev" }];
		const result = filterAndSortBranches(branches, "dev", (branch) => branch.name);

		expect(result).toEqual([{ name: "dev" }, { name: "development" }]);
		expect(branches).toEqual([{ name: "development" }, { name: "dev" }]);
	});
});
