import { beforeEach, describe, expect, test } from "bun:test";
import {
	clearAllModelRepoPaths,
	clearModelRepoPath,
	findRepoPathFromUri,
	getModelRepoPath,
	setModelRepoPath,
} from "../src/renderer/lsp/model-repo-map";

describe("model-repo-map", () => {
	beforeEach(() => {
		clearAllModelRepoPaths();
	});

	test("set then get returns path", () => {
		setModelRepoPath("file:///tmp/a.ts", "/tmp");
		expect(getModelRepoPath("file:///tmp/a.ts")).toBe("/tmp");
	});

	test("get returns null for unknown uri", () => {
		expect(getModelRepoPath("file:///nope.ts")).toBeNull();
	});

	test("clear removes entry", () => {
		setModelRepoPath("file:///tmp/b.ts", "/tmp");
		clearModelRepoPath("file:///tmp/b.ts");
		expect(getModelRepoPath("file:///tmp/b.ts")).toBeNull();
	});

	test("clearAll empties the map", () => {
		setModelRepoPath("file:///tmp/c.ts", "/tmp");
		setModelRepoPath("file:///tmp/d.ts", "/other");
		clearAllModelRepoPaths();
		expect(getModelRepoPath("file:///tmp/c.ts")).toBeNull();
		expect(getModelRepoPath("file:///tmp/d.ts")).toBeNull();
	});

	test("findRepoPathFromUri finds matching prefix", () => {
		setModelRepoPath("file:///repo/a.ts", "/repo");
		expect(findRepoPathFromUri("file:///repo/nested/b.ts")).toBe("/repo");
	});

	test("findRepoPathFromUri returns null when no match", () => {
		setModelRepoPath("file:///repo/a.ts", "/repo");
		expect(findRepoPathFromUri("file:///elsewhere/c.ts")).toBeNull();
	});
});
