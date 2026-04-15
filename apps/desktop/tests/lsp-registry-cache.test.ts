import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _clearRegistryFsCache, loadRepoConfigCached } from "../src/main/lsp/registry";

let tmpRepo: string;

beforeEach(() => {
	tmpRepo = mkdtempSync(join(tmpdir(), "ss-lsp-cache-"));
	_clearRegistryFsCache();
});

describe("loadRepoConfigCached", () => {
	test("second call with unchanged mtime returns same array reference", () => {
		const cfgDir = join(tmpRepo, ".superiorswarm");
		mkdirSync(cfgDir);
		writeFileSync(
			join(cfgDir, "lsp.json"),
			JSON.stringify({ servers: [{ id: "x", command: "x" }] })
		);

		const first = loadRepoConfigCached(tmpRepo);
		const second = loadRepoConfigCached(tmpRepo);
		expect(second).toBe(first);
	});

	test("changed mtime invalidates cache", () => {
		const cfgDir = join(tmpRepo, ".superiorswarm");
		mkdirSync(cfgDir);
		const path = join(cfgDir, "lsp.json");
		writeFileSync(path, JSON.stringify({ servers: [{ id: "a", command: "a" }] }));

		const first = loadRepoConfigCached(tmpRepo);
		expect(first).toHaveLength(1);
		expect(first[0]?.id).toBe("a");

		writeFileSync(path, JSON.stringify({ servers: [{ id: "b", command: "b" }] }));
		// Force distinct mtime (some filesystems have 1s granularity)
		const future = new Date(Date.now() + 5_000);
		utimesSync(path, future, future);

		const second = loadRepoConfigCached(tmpRepo);
		expect(second).not.toBe(first);
		expect(second[0]?.id).toBe("b");
	});

	test("missing file returns stable empty array", () => {
		const first = loadRepoConfigCached(tmpRepo);
		const second = loadRepoConfigCached(tmpRepo);
		expect(first).toEqual([]);
		expect(second).toBe(first);
	});

	test("saveConfigFile invalidates the cache", async () => {
		const { saveConfigFile } = await import("../src/main/lsp/registry");
		const path = join(tmpRepo, ".superiorswarm", "lsp.json");
		mkdirSync(join(tmpRepo, ".superiorswarm"));
		writeFileSync(path, JSON.stringify({ servers: [{ id: "x", command: "x" }] }));
		const first = loadRepoConfigCached(tmpRepo);
		saveConfigFile(path, [
			{
				id: "y",
				command: "y",
				args: [],
				languages: [],
				fileExtensions: [],
				rootMarkers: [".git"],
				disabled: false,
			},
		]);
		const second = loadRepoConfigCached(tmpRepo);
		expect(second).not.toBe(first);
		expect(second[0]?.id).toBe("y");
	});
});
