import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSuggestions } from "../src/main/lsp/detect";

let repo: string;

function touch(relPath: string, content = "") {
	const full = join(repo, relPath);
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

describe("detectSuggestions", () => {
	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), "ss-detect-"));
	});

	afterEach(() => {
		rmSync(repo, { recursive: true, force: true });
	});

	test("suggests presets whose extensions match repo files", () => {
		touch("src/main.py");
		touch("src/util.py");
		touch("pyproject.toml");

		const result = detectSuggestions(repo, { alreadyConfigured: new Set() });

		const ids = result.map((s) => s.id);
		expect(ids).toContain("python");
	});

	test("orders suggestions by file count desc", () => {
		for (let i = 0; i < 10; i++) touch(`src/a${i}.py`);
		for (let i = 0; i < 3; i++) touch(`src/b${i}.go`);

		const result = detectSuggestions(repo, { alreadyConfigured: new Set() });
		const ids = result.map((s) => s.id);
		const pyIdx = ids.indexOf("python");
		const goIdx = ids.indexOf("go");

		expect(pyIdx).toBeGreaterThanOrEqual(0);
		expect(goIdx).toBeGreaterThanOrEqual(0);
		expect(pyIdx).toBeLessThan(goIdx);
	});

	test("matches by filename for filename-only presets (Dockerfile)", () => {
		touch("Dockerfile", "FROM alpine\n");

		const result = detectSuggestions(repo, { alreadyConfigured: new Set() });
		expect(result.map((s) => s.id)).toContain("dockerfile");
	});

	test("excludes already-configured server ids", () => {
		touch("src/main.go");

		const result = detectSuggestions(repo, { alreadyConfigured: new Set(["go"]) });
		expect(result.map((s) => s.id)).not.toContain("go");
	});

	test("returns up to 3 sample file paths per suggestion", () => {
		for (let i = 0; i < 8; i++) touch(`src/${i}.rs`);

		const result = detectSuggestions(repo, { alreadyConfigured: new Set() });
		const rust = result.find((s) => s.id === "rust");
		expect(rust).toBeDefined();
		expect(rust?.sampleFiles.length).toBeLessThanOrEqual(3);
		expect(rust?.sampleFiles.length).toBeGreaterThan(0);
	});

	test("reports totalFileCount not limited to the sample size", () => {
		for (let i = 0; i < 20; i++) touch(`src/${i}.py`);

		const result = detectSuggestions(repo, { alreadyConfigured: new Set() });
		const py = result.find((s) => s.id === "python");
		expect(py?.fileCount).toBe(20);
	});

	test("skips common ignored directories", () => {
		touch("node_modules/foo/index.ts");
		touch(".git/HEAD");
		touch("dist/out.go");
		touch("src/real.py");

		const result = detectSuggestions(repo, { alreadyConfigured: new Set() });
		const ids = result.map((s) => s.id);
		expect(ids).toContain("python");
		// node_modules ts files should not pull in typescript
		expect(ids).not.toContain("typescript");
		// dist go files should not pull in go
		expect(ids).not.toContain("go");
	});

	test("respects file budget cap", () => {
		// 6000 files — exceeds default cap of 5000
		for (let i = 0; i < 6000; i++) touch(`flat/${i}.py`);

		const result = detectSuggestions(repo, {
			alreadyConfigured: new Set(),
			maxFiles: 100,
		});
		const py = result.find((s) => s.id === "python");
		expect(py?.fileCount).toBeLessThanOrEqual(100);
	});

	test("returns empty list for an empty repo", () => {
		const result = detectSuggestions(repo, { alreadyConfigured: new Set() });
		expect(result).toEqual([]);
	});
});
