import { describe, expect, test } from "bun:test";
import { buildCandidateTree, type CandidateEntry } from "../src/main/trpc/build-candidate-tree";

describe("buildCandidateTree", () => {
	test("returns empty array for empty input", () => {
		expect(buildCandidateTree([])).toEqual([]);
	});

	test("puts root-level files at top level", () => {
		const result = buildCandidateTree([".env", ".env.local"]);
		expect(result).toEqual([
			{ name: ".env", relativePath: ".env", type: "file" },
			{ name: ".env.local", relativePath: ".env.local", type: "file" },
		]);
	});

	test("groups files under directory nodes", () => {
		const result = buildCandidateTree(["dist/index.js", "dist/utils.js"]);
		expect(result).toEqual([
			{
				name: "dist",
				relativePath: "dist",
				type: "directory",
				children: [
					{ name: "index.js", relativePath: "dist/index.js", type: "file" },
					{ name: "utils.js", relativePath: "dist/utils.js", type: "file" },
				],
			},
		]);
	});

	test("handles nested directories", () => {
		const result = buildCandidateTree(["build/static/app.js", "build/static/app.css"]);
		expect(result).toEqual([
			{
				name: "build",
				relativePath: "build",
				type: "directory",
				children: [
					{
						name: "static",
						relativePath: "build/static",
						type: "directory",
						children: [
							{ name: "app.css", relativePath: "build/static/app.css", type: "file" },
							{ name: "app.js", relativePath: "build/static/app.js", type: "file" },
						],
					},
				],
			},
		]);
	});

	test("mixes root files and directories, sorted: files first then dirs", () => {
		const result = buildCandidateTree([".env", "dist/index.js", ".env.local", "build/out.js"]);
		expect(result).toHaveLength(4);
		// Root files come first (sorted alphabetically)
		expect(result[0]).toEqual({ name: ".env", relativePath: ".env", type: "file" });
		expect(result[1]).toEqual({ name: ".env.local", relativePath: ".env.local", type: "file" });
		// Then directories (sorted alphabetically)
		expect(result[2]?.name).toBe("build");
		expect(result[2]?.type).toBe("directory");
		expect(result[3]?.name).toBe("dist");
		expect(result[3]?.type).toBe("directory");
	});

	test("children within directories are sorted: files first then dirs", () => {
		const result = buildCandidateTree([
			"config/secrets/key.pem",
			"config/.env",
		]);
		expect(result).toHaveLength(1);
		const configNode = result[0]!;
		expect(configNode.children).toHaveLength(2);
		// File first, then directory
		expect(configNode.children![0]?.name).toBe(".env");
		expect(configNode.children![0]?.type).toBe("file");
		expect(configNode.children![1]?.name).toBe("secrets");
		expect(configNode.children![1]?.type).toBe("directory");
	});
});
