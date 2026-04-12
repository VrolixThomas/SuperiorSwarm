import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockServerManager = {
	getHealth: mock(() => []),
};

mock.module("../src/main/lsp/server-manager", () => ({
	serverManager: mockServerManager,
}));

const { lspRouter } = await import("../src/main/trpc/routers/lsp");
const { t } = await import("../src/main/trpc/index");

const caller = t.createCallerFactory(lspRouter)({});

describe("lsp tRPC router", () => {
	beforeEach(() => {
		mockServerManager.getHealth.mockReset();
		mockServerManager.getHealth.mockImplementation(() => []);
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
	});
});
