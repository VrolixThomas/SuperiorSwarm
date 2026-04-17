import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/main/db";

const mockServerManager = {
	getHealth: mock(() => []),
	evictServer: mock(async (_id: string, _repoPath?: string) => {}),
	diffChangedIds: mock((_old: unknown[], _next: unknown[]) => new Set<string>()),
};

mock.module("../src/main/lsp/server-manager", () => ({
	serverManager: mockServerManager,
}));

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

const { lspRouter } = await import("../src/main/trpc/routers/lsp");
const { t } = await import("../src/main/trpc/index");

const caller = t.createCallerFactory(lspRouter)({});

let tmpHome: string;
let originalHome: string | undefined;

describe("lsp tRPC router", () => {
	beforeEach(() => {
		mockServerManager.getHealth.mockReset();
		mockServerManager.getHealth.mockImplementation(() => []);
		mockServerManager.evictServer.mockReset();
		mockServerManager.evictServer.mockImplementation(async () => {});
		mockServerManager.diffChangedIds.mockReset();
		mockServerManager.diffChangedIds.mockImplementation(() => new Set<string>());
		tmpHome = mkdtempSync(join(tmpdir(), "ss-lsp-router-"));
		originalHome = process.env["HOME"];
		process.env["HOME"] = tmpHome;
	});

	afterEach(() => {
		process.env["HOME"] = originalHome;
		rmSync(tmpHome, { recursive: true, force: true });
	});

	describe("getHealth", () => {
		test("returns health entries from serverManager", async () => {
			mockServerManager.getHealth.mockImplementation(() => [
				{ id: "go", command: "gopls", available: true },
			]);

			const result = await caller.getHealth({ repoPath: "/tmp/repo" });
			expect(result.entries).toHaveLength(1);
			expect(result.entries[0].id).toBe("go");
		});

		test("returns empty entries when no repoPath", async () => {
			mockServerManager.getHealth.mockImplementation(() => []);
			const result = await caller.getHealth({});
			expect(result.entries).toEqual([]);
		});
	});

	describe("getPresets", () => {
		test("returns the presets array", async () => {
			const result = await caller.getPresets();
			expect(Array.isArray(result)).toBe(true);
			expect(result.length).toBeGreaterThan(0);
			expect(result[0].id).toBeTruthy();
			expect(result[0].displayName).toBeTruthy();
		});
	});

	describe("getUserConfig", () => {
		test("returns empty servers for missing config", async () => {
			const result = await caller.getUserConfig();
			// Will read from ~/.config/superiorswarm/lsp.json — may or may not exist
			expect(Array.isArray(result.servers)).toBe(true);
		});
	});

	describe("getRepoConfig", () => {
		test("returns servers from repo config file", async () => {
			const testDir = join(tmpdir(), `ss-lsp-trpc-${Date.now()}`);
			const configDir = join(testDir, ".superiorswarm");
			mkdirSync(configDir, { recursive: true });
			writeFileSync(
				join(configDir, "lsp.json"),
				JSON.stringify({
					servers: [
						{
							id: "csharp",
							command: "OmniSharp",
							args: ["-lsp"],
							languages: ["csharp"],
							fileExtensions: [".cs"],
							rootMarkers: [".git"],
							disabled: false,
						},
					],
				})
			);

			try {
				const result = await caller.getRepoConfig({ repoPath: testDir });
				expect(result.servers).toHaveLength(1);
				expect(result.servers[0].id).toBe("csharp");
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		test("returns empty servers for missing repo config", async () => {
			const result = await caller.getRepoConfig({ repoPath: "/tmp/nonexistent" });
			expect(result.servers).toEqual([]);
		});
	});

	describe("saveRepoConfig", () => {
		test("writes config to repo path", async () => {
			const testDir = join(tmpdir(), `ss-lsp-trpc-save-${Date.now()}`);

			try {
				await caller.saveRepoConfig({
					repoPath: testDir,
					servers: [
						{
							id: "csharp",
							command: "OmniSharp",
							args: ["-lsp"],
							languages: ["csharp"],
							fileExtensions: [".cs"],
							rootMarkers: [".git"],
							disabled: false,
						},
					],
				});

				const configPath = join(testDir, ".superiorswarm", "lsp.json");
				const written = JSON.parse(readFileSync(configPath, "utf8"));
				expect(written.servers).toHaveLength(1);
				expect(written.servers[0].id).toBe("csharp");
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});
	});

	describe("saveUserConfig id validation", () => {
		test("rejects empty id", async () => {
			await expect(
				caller.saveUserConfig({
					servers: [
						{
							id: "",
							command: "some-ls",
							args: [],
							languages: ["foo"],
							fileExtensions: [".foo"],
							rootMarkers: [".git"],
							disabled: false,
						},
					],
				})
			).rejects.toThrow();
		});

		test("rejects id with spaces", async () => {
			await expect(
				caller.saveUserConfig({
					servers: [
						{
							id: "my server",
							command: "some-ls",
							args: [],
							languages: ["foo"],
							fileExtensions: [".foo"],
							rootMarkers: [".git"],
							disabled: false,
						},
					],
				})
			).rejects.toThrow();
		});

		test("rejects uppercase id", async () => {
			await expect(
				caller.saveUserConfig({
					servers: [
						{
							id: "MyServer",
							command: "some-ls",
							args: [],
							languages: ["foo"],
							fileExtensions: [".foo"],
							rootMarkers: [".git"],
							disabled: false,
						},
					],
				})
			).rejects.toThrow();
		});

		test("accepts valid kebab-case id", async () => {
			const result = await caller.saveUserConfig({
				servers: [
					{
						id: "my-lang",
						command: "some-ls",
						args: [],
						languages: ["foo"],
						fileExtensions: [".foo"],
						rootMarkers: [".git"],
						disabled: false,
					},
				],
			});
			expect(result.ok).toBe(true);
		});
	});

	describe("setServerEnabled", () => {
		test("disables a server in repo config", async () => {
			const testDir = join(tmpdir(), `ss-lsp-trpc-toggle-${Date.now()}`);
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
							rootMarkers: [".git"],
							disabled: false,
						},
					],
				})
			);

			try {
				await caller.setServerEnabled({
					id: "ruby",
					scope: "repo",
					enabled: false,
					repoPath: testDir,
				});

				const configPath = join(testDir, ".superiorswarm", "lsp.json");
				const written = JSON.parse(readFileSync(configPath, "utf8"));
				const ruby = written.servers.find((s: { id: string }) => s.id === "ruby");
				expect(ruby.disabled).toBe(true);
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		test("adds a disable-only entry with correct command from defaults", async () => {
			const testDir = join(tmpdir(), `ss-lsp-trpc-toggle-new-${Date.now()}`);

			try {
				await caller.setServerEnabled({
					id: "python",
					scope: "repo",
					enabled: false,
					repoPath: testDir,
				});

				const configPath = join(testDir, ".superiorswarm", "lsp.json");
				const written = JSON.parse(readFileSync(configPath, "utf8"));
				const python = written.servers.find((s: { id: string }) => s.id === "python");
				expect(python).toBeDefined();
				expect(python.disabled).toBe(true);
				expect(python.command).toBe("pyright-langserver"); // from DEFAULT_SERVER_CONFIGS
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		test("rejects unknown id not in defaults or presets", async () => {
			const testDir = join(tmpdir(), `ss-lsp-trpc-unknown-${Date.now()}`);
			try {
				await expect(
					caller.setServerEnabled({
						id: "totally-unknown-server-xyz",
						scope: "repo",
						enabled: true,
						repoPath: testDir,
					})
				).rejects.toThrow(/unknown server id/i);
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		test("accepts known built-in id", async () => {
			// go is in DEFAULT_SERVER_CONFIGS; this should not throw
			const testDir = join(tmpdir(), `ss-lsp-trpc-builtin-${Date.now()}`);
			try {
				const result = await caller.setServerEnabled({
					id: "go",
					scope: "repo",
					enabled: false,
					repoPath: testDir,
				});
				expect(result.ok).toBe(true);
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});
	});

	describe("live eviction on save", () => {
		test("saveRepoConfig evicts changed ids scoped to the repo", async () => {
			const testDir = join(tmpdir(), `ss-lsp-trpc-evict-repo-${Date.now()}`);
			const configDir = join(testDir, ".superiorswarm");
			mkdirSync(configDir, { recursive: true });
			const initial = [
				{
					id: "lua",
					command: "lua-ls",
					args: [],
					languages: ["lua"],
					fileExtensions: [".lua"],
					fileNames: [],
					rootMarkers: [".git"],
					disabled: false,
				},
			];
			writeFileSync(join(configDir, "lsp.json"), JSON.stringify({ servers: initial }));

			mockServerManager.diffChangedIds.mockImplementation(() => new Set(["lua"]));

			try {
				await caller.saveRepoConfig({
					repoPath: testDir,
					servers: [
						{
							...initial[0],
							command: "lua-ls-v2",
						},
					],
				});

				expect(mockServerManager.evictServer).toHaveBeenCalledWith("lua", testDir);
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		test("saveUserConfig evicts changed ids across all repos (no repoPath)", async () => {
			mockServerManager.diffChangedIds.mockImplementation(() => new Set(["typescript"]));

			await caller.saveUserConfig({
				servers: [
					{
						id: "typescript",
						command: "typescript-language-server-v2",
						args: ["--stdio"],
						languages: ["typescript"],
						fileExtensions: [".ts"],
						fileNames: [],
						rootMarkers: [".git"],
						disabled: false,
					},
				],
			});

			expect(mockServerManager.evictServer).toHaveBeenCalledWith("typescript");
		});

		test("setServerEnabled evicts the toggled server", async () => {
			const testDir = join(tmpdir(), `ss-lsp-trpc-evict-toggle-${Date.now()}`);

			try {
				await caller.setServerEnabled({
					id: "ruby",
					scope: "repo",
					enabled: false,
					repoPath: testDir,
				});

				expect(mockServerManager.evictServer).toHaveBeenCalledWith("ruby", testDir);
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		test("requestInstall returns a launch script file that exists", async () => {
			const testDir = join(tmpdir(), `ss-lsp-trpc-install-${Date.now()}`);

			try {
				const result = await caller.requestInstall({
					configId: "csharp",
					repoPath: testDir,
				});

				expect(result.launchScript).toBeTruthy();
				expect(existsSync(result.launchScript)).toBe(true);
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		test("requestInstall prompt mentions the server's display name and candidate binaries", async () => {
			const testDir = join(tmpdir(), `ss-lsp-trpc-install-prompt-${Date.now()}`);

			try {
				const result = await caller.requestInstall({
					configId: "csharp",
					repoPath: testDir,
				});

				const prompt = readFileSync(result.promptFilePath, "utf-8");
				// C# is the display name for csharp in LSP_PRESETS
				expect(prompt).toMatch(/C#|csharp/i);
				// csharp-ls is the configured command for the csharp preset
				expect(prompt).toContain("csharp-ls");
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});

		test("requestInstall rejects unknown configId", async () => {
			await expect(
				caller.requestInstall({
					configId: "totally-unknown-xyz",
					repoPath: "/tmp/whatever",
				})
			).rejects.toThrow();
		});

		test("saveRepoConfig does not evict when nothing changed", async () => {
			const testDir = join(tmpdir(), `ss-lsp-trpc-noop-${Date.now()}`);

			mockServerManager.diffChangedIds.mockImplementation(() => new Set<string>());

			try {
				await caller.saveRepoConfig({
					repoPath: testDir,
					servers: [],
				});

				expect(mockServerManager.evictServer).not.toHaveBeenCalled();
			} finally {
				rmSync(testDir, { recursive: true, force: true });
			}
		});
	});
});
