import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_SERVER_CONFIGS,
	type LanguageServerConfig,
	buildRegistry,
	loadRepoConfig,
	resolveSupport,
	saveConfigFile,
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
	test("returns configured server id for go", () => {
		const registry = buildRegistry({
			defaults: DEFAULT_SERVER_CONFIGS,
			user: [],
			repo: [],
			env: {},
		});

		const support = resolveSupport(registry, { languageId: "go", filePath: "main.go" });
		expect(support.supported).toBe(true);
		if (support.supported) {
			expect(support.config.id).toBe("go");
		}
	});

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
	test("logs warning and skips invalid entries", () => {
		const testDir = join(tmpdir(), `ss-lsp-registry-${Date.now()}-warn`);
		const configDir = join(testDir, ".superiorswarm");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			join(configDir, "lsp.json"),
			JSON.stringify({
				servers: [
					{
						id: "ruby",
						command: "solargraph",
						args: ["stdio"],
						languages: ["ruby"],
						fileExtensions: [".rb"],
						rootMarkers: ["Gemfile", ".git"],
						disabled: false,
					},
					{ id: "invalid-entry-missing-command" },
				],
			})
		);

		const warnCalls: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnCalls.push(String(args[0] ?? ""));
		};

		try {
			expect(loadRepoConfig(testDir)).toEqual([
				{
					id: "ruby",
					command: "solargraph",
					args: ["stdio"],
					languages: ["ruby"],
					fileExtensions: [".rb"],
					rootMarkers: ["Gemfile", ".git"],
					disabled: false,
				},
			]);
			expect(warnCalls).toHaveLength(1);
			expect(warnCalls[0]).toContain("Ignoring invalid LSP server entry");
		} finally {
			console.warn = originalWarn;
			rmSync(testDir, { recursive: true, force: true });
		}
	});

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

	test("keeps valid server entries when some entries are invalid", () => {
		const testDir = join(tmpdir(), `ss-lsp-registry-${Date.now()}-mixed`);
		const configDir = join(testDir, ".superiorswarm");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			join(configDir, "lsp.json"),
			JSON.stringify({
				servers: [
					{
						id: "ruby",
						command: "solargraph",
						args: ["stdio"],
						languages: ["ruby"],
						fileExtensions: [".rb"],
						rootMarkers: ["Gemfile", ".git"],
						disabled: false,
					},
					{ id: "invalid-entry-missing-command" },
				],
			})
		);

		try {
			expect(loadRepoConfig(testDir)).toEqual([
				{
					id: "ruby",
					command: "solargraph",
					args: ["stdio"],
					languages: ["ruby"],
					fileExtensions: [".rb"],
					rootMarkers: ["Gemfile", ".git"],
					disabled: false,
				},
			]);
		} finally {
			rmSync(testDir, { recursive: true, force: true });
		}
	});
});

describe("saveConfigFile", () => {
	test("creates directory and file when they don't exist", () => {
		const testDir = join(tmpdir(), `ss-lsp-save-${Date.now()}-create`);
		const configPath = join(testDir, ".superiorswarm", "lsp.json");

		try {
			const servers = [
				{
					id: "csharp",
					command: "OmniSharp",
					args: ["-lsp"],
					languages: ["csharp"],
					fileExtensions: [".cs"],
					rootMarkers: [".git"],
					disabled: false,
				},
			];

			saveConfigFile(configPath, servers);

			expect(existsSync(configPath)).toBe(true);
			const written = JSON.parse(readFileSync(configPath, "utf8"));
			expect(written.servers).toHaveLength(1);
			expect(written.servers[0].id).toBe("csharp");
		} finally {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	test("overwrites existing config file", () => {
		const testDir = join(tmpdir(), `ss-lsp-save-${Date.now()}-overwrite`);
		const configDir = join(testDir, ".superiorswarm");
		mkdirSync(configDir, { recursive: true });
		const configPath = join(configDir, "lsp.json");
		writeFileSync(configPath, JSON.stringify({ servers: [{ id: "old", command: "old-ls", args: [], languages: ["old"], fileExtensions: [".old"], rootMarkers: [".git"], disabled: false }] }));

		try {
			const servers = [
				{
					id: "new",
					command: "new-ls",
					args: [],
					languages: ["new"],
					fileExtensions: [".new"],
					rootMarkers: [".git"],
					disabled: false,
				},
			];

			saveConfigFile(configPath, servers);

			const written = JSON.parse(readFileSync(configPath, "utf8"));
			expect(written.servers).toHaveLength(1);
			expect(written.servers[0].id).toBe("new");
		} finally {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	test("validates servers before writing and rejects invalid entries", () => {
		const testDir = join(tmpdir(), `ss-lsp-save-${Date.now()}-invalid`);
		const configPath = join(testDir, ".superiorswarm", "lsp.json");

		try {
			expect(() => {
				saveConfigFile(configPath, [{ id: "", command: "" } as any]);
			}).toThrow();

			expect(existsSync(configPath)).toBe(false);
		} finally {
			rmSync(testDir, { recursive: true, force: true });
		}
	});
});
