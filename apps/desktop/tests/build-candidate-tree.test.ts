import { describe, expect, test } from "bun:test";
import {
	type CandidateEntry,
	buildCandidateTree,
	buildSmartCandidateTree,
	countFiles,
} from "../src/main/trpc/build-candidate-tree";

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
		const result = buildCandidateTree(["config/secrets/key.pem", "config/.env"]);
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

describe("countFiles", () => {
	test("returns 0 for empty entry with no children", () => {
		const entry: CandidateEntry = {
			name: "empty",
			relativePath: "empty",
			type: "directory",
			children: [],
		};
		expect(countFiles(entry)).toBe(0);
	});

	test("returns 1 for a file entry", () => {
		const entry: CandidateEntry = { name: ".env", relativePath: ".env", type: "file" };
		expect(countFiles(entry)).toBe(1);
	});

	test("counts all nested files", () => {
		const tree = buildCandidateTree(["dist/a.js", "dist/b.js", "dist/sub/c.js"]);
		const distNode = tree.find((e) => e.name === "dist")!;
		expect(countFiles(distNode)).toBe(3);
	});
});

describe("buildSmartCandidateTree", () => {
	test("returns empty for empty input", () => {
		expect(buildSmartCandidateTree([], () => false)).toEqual([]);
	});

	test("files in a gitignored dir are grouped under that dir", () => {
		const result = buildSmartCandidateTree(
			["dist/index.js", "dist/utils.js"],
			(p) => p === "dist",
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe("dist");
		expect(result[0]?.type).toBe("directory");
		expect(result[0]?.relativePath).toBe("dist");
		expect(result[0]?.children).toHaveLength(2);
		expect(result[0]?.children![0]?.relativePath).toBe("dist/index.js");
		expect(result[0]?.children![1]?.relativePath).toBe("dist/utils.js");
	});

	test("file with no gitignored ancestor appears as root file with full path as name", () => {
		const result = buildSmartCandidateTree(["apps/desktop/.env"], () => false);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			name: "apps/desktop/.env",
			relativePath: "apps/desktop/.env",
			type: "file",
		});
	});

	test("direct files come before directory entries", () => {
		const result = buildSmartCandidateTree(
			["apps/desktop/.env", "dist/index.js"],
			(p) => p === "dist",
		);
		expect(result).toHaveLength(2);
		expect(result[0]?.type).toBe("file");
		expect(result[0]?.name).toBe("apps/desktop/.env");
		expect(result[1]?.type).toBe("directory");
		expect(result[1]?.name).toBe("dist");
	});

	test("uses topmost gitignored ancestor, not deepest", () => {
		// apps/desktop/dist/main.js — only "apps/desktop/dist" is ignored, not "apps" or "apps/desktop"
		const isIgnored = (p: string) => p === "apps/desktop/dist";
		const result = buildSmartCandidateTree(
			["apps/desktop/dist/main.js", "apps/desktop/.env"],
			isIgnored,
		);
		// direct file
		expect(result.find((e) => e.type === "file")?.name).toBe("apps/desktop/.env");
		// directory entry should be rooted at apps/desktop/dist
		const dir = result.find((e) => e.type === "directory");
		expect(dir?.relativePath).toBe("apps/desktop/dist");
		expect(dir?.name).toBe("dist");
	});

	test("children of gitignored dir have correct full relativePaths", () => {
		const result = buildSmartCandidateTree(
			["dist/sub/file.js"],
			(p) => p === "dist",
		);
		const distNode = result[0]!;
		const subNode = distNode.children![0]!;
		expect(subNode.name).toBe("sub");
		expect(subNode.relativePath).toBe("dist/sub");
		expect(subNode.children![0]?.relativePath).toBe("dist/sub/file.js");
	});

	test("multiple gitignored dirs each get their own node", () => {
		const result = buildSmartCandidateTree(
			[".turbo/cache/file.json", "dist/index.js"],
			(p) => p === "dist" || p === ".turbo",
		);
		expect(result).toHaveLength(2);
		const names = result.map((e) => e.name).sort();
		expect(names).toEqual([".turbo", "dist"]);
	});
});
