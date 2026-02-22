import { describe, expect, test } from "bun:test";
import { extractRepoName, parseGitHubUrl, validateGitUrl } from "../src/main/git/operations";

describe("validateGitUrl", () => {
	test("accepts HTTPS GitHub URL", () => {
		expect(validateGitUrl("https://github.com/owner/repo.git")).toBe(true);
	});

	test("accepts HTTPS URL without .git", () => {
		expect(validateGitUrl("https://github.com/owner/repo")).toBe(true);
	});

	test("accepts SSH URL", () => {
		expect(validateGitUrl("git@github.com:owner/repo.git")).toBe(true);
	});

	test("rejects empty string", () => {
		expect(validateGitUrl("")).toBe(false);
	});

	test("rejects random text", () => {
		expect(validateGitUrl("not a url")).toBe(false);
	});
});

describe("extractRepoName", () => {
	test("extracts name from HTTPS URL with .git", () => {
		expect(extractRepoName("https://github.com/owner/repo.git")).toBe("repo");
	});

	test("extracts name from HTTPS URL without .git", () => {
		expect(extractRepoName("https://github.com/owner/repo")).toBe("repo");
	});

	test("extracts name from SSH URL", () => {
		expect(extractRepoName("git@github.com:owner/repo.git")).toBe("repo");
	});
});

describe("parseGitHubUrl", () => {
	test("parses HTTPS URL", () => {
		expect(parseGitHubUrl("https://github.com/owner/repo.git")).toEqual({
			owner: "owner",
			repo: "repo",
		});
	});

	test("parses SSH URL", () => {
		expect(parseGitHubUrl("git@github.com:owner/repo.git")).toEqual({
			owner: "owner",
			repo: "repo",
		});
	});

	test("returns null for non-GitHub URL", () => {
		expect(parseGitHubUrl("https://gitlab.com/owner/repo.git")).toBeNull();
	});
});
