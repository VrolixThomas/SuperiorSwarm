import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_SERVER_CONFIGS,
	buildRegistry,
	loadRepoConfig,
	resolveSupport,
	type LanguageServerConfig,
} from "../src/main/lsp/registry";

describe("buildRegistry", () => {
	test("repo config overrides user and defaults", () => {
		const defaults: LanguageServerConfig[] = [
			{
				id: "python",
				command: "pyright-langserver",
				args: ["--stdio"],
				languages: ["python"],
				fileExtensions: [".py"],
				rootMarkers: [".git"],
				disabled: false,
			},
		];
		const user: LanguageServerConfig[] = [
			{
				id: "python",
				command: "custom-pyright",
				args: ["--stdio"],
				languages: ["python"],
				fileExtensions: [".py"],
				rootMarkers: [".git"],
				disabled: false,
			},
		];
		const repo: LanguageServerConfig[] = [
			{
				id: "python",
				command: "repo-pyright",
				args: ["--stdio"],
				languages: ["python"],
				fileExtensions: [".py"],
				rootMarkers: [".git"],
				disabled: false,
			},
		];

		const registry = buildRegistry({ defaults, user, repo, env: {} });
		expect(registry.byId.get("python")?.command).toBe("repo-pyright");
	});

	test("disabled server is excluded from support", () => {
		const registry = buildRegistry({
			defaults: DEFAULT_SERVER_CONFIGS,
			user: [
				{
					id: "python",
					command: "pyright-langserver",
					args: ["--stdio"],
					languages: ["python"],
					fileExtensions: [".py"],
					rootMarkers: [".git"],
					disabled: true,
				},
			],
			repo: [],
			env: {},
		});
		const support = resolveSupport(registry, { languageId: "python", filePath: "x.py" });
		expect(support.supported).toBe(false);
	});

	test("interpolates workspaceFolder and env vars", () => {
		const registry = buildRegistry({
			defaults: [],
			user: [
				{
					id: "go",
					command: "${env:BIN_DIR}/gopls",
					args: ["-logfile", "${workspaceFolder}/.logs/gopls.log"],
					languages: ["go"],
					fileExtensions: [".go"],
					rootMarkers: ["go.mod", ".git"],
					disabled: false,
				},
			],
			repo: [],
			env: {
				workspaceFolder: "/repo/worktree",
				BIN_DIR: "/opt/bin",
			},
		});

		const goConfig = registry.byId.get("go");
		expect(goConfig?.command).toBe("/opt/bin/gopls");
		expect(goConfig?.args).toEqual(["-logfile", "/repo/worktree/.logs/gopls.log"]);
	});
});

describe("resolveSupport", () => {
	test("resolves by languageId first, then extension", () => {
		const registry = buildRegistry({
			defaults: [],
			user: [
				{
					id: "a",
					command: "a-ls",
					args: [],
					languages: ["foo"],
					fileExtensions: [".foo"],
					rootMarkers: [".git"],
					disabled: false,
				},
				{
					id: "b",
					command: "b-ls",
					args: [],
					languages: ["bar"],
					fileExtensions: [".foo"],
					rootMarkers: [".git"],
					disabled: false,
				},
			],
			repo: [],
			env: {},
		});

		const byLanguage = resolveSupport(registry, { languageId: "foo", filePath: "x.foo" });
		expect(byLanguage.supported).toBe(true);
		if (byLanguage.supported) {
			expect(byLanguage.config.id).toBe("a");
			expect(byLanguage.reason).toBe("language");
		}

		const byExtension = resolveSupport(registry, { languageId: "unknown", filePath: "x.foo" });
		expect(byExtension.supported).toBe(true);
		if (byExtension.supported) {
			expect(byExtension.reason).toBe("extension");
		}
	});
});

describe("loadRepoConfig", () => {
	test("returns empty array when config is invalid JSON", () => {
		const testDir = join(tmpdir(), `ss-lsp-registry-${Date.now()}-invalid`);
		const configDir = join(testDir, ".superiorswarm");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(join(configDir, "lsp.json"), "{ not-json }");

		try {
			expect(loadRepoConfig(testDir)).toEqual([]);
		} finally {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	test("returns empty array when config fails schema validation", () => {
		const testDir = join(tmpdir(), `ss-lsp-registry-${Date.now()}-schema`);
		const configDir = join(testDir, ".superiorswarm");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(join(configDir, "lsp.json"), JSON.stringify({ servers: [{ id: "python" }] }));

		try {
			expect(loadRepoConfig(testDir)).toEqual([]);
		} finally {
			rmSync(testDir, { recursive: true, force: true });
		}
	});
});
