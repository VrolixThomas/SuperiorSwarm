import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_PRESETS, type LaunchOptions } from "../src/main/ai-review/cli-presets";

function fakeLaunchOpts(worktreePath: string): LaunchOptions {
	return {
		mcpServerPath: "/fake/mcp-standalone/server.mjs",
		worktreePath,
		reviewDir: join(worktreePath, ".reviews", "abc"),
		promptFilePath: join(worktreePath, ".reviews", "abc", "prompt.txt"),
		dbPath: "/fake/db.sqlite",
		reviewDraftId: "draft-abc",
		prMetadata: JSON.stringify({ title: "Test PR" }),
	};
}

describe("CLI presets setupMcp — Electron runtime", () => {
	let worktree: string;

	beforeEach(() => {
		worktree = join(tmpdir(), `ss-setupmcp-${process.pid}-${Date.now()}`);
		mkdirSync(worktree, { recursive: true });
	});

	afterEach(() => {
		rmSync(worktree, { recursive: true, force: true });
	});

	test("claude preset writes .mcp.json with Electron binary + ELECTRON_RUN_AS_NODE=1", () => {
		const preset = CLI_PRESETS.claude;
		const opts = fakeLaunchOpts(worktree);

		const cleanup = preset.setupMcp?.(opts);
		try {
			const configPath = join(worktree, ".mcp.json");
			const cfg = JSON.parse(readFileSync(configPath, "utf-8"));

			expect(cfg.mcpServers.superiorswarm.command).toBe(process.execPath);
			expect(cfg.mcpServers.superiorswarm.args).toEqual([opts.mcpServerPath]);
			expect(cfg.mcpServers.superiorswarm.env.ELECTRON_RUN_AS_NODE).toBe("1");
			expect(cfg.mcpServers.superiorswarm.env.REVIEW_DRAFT_ID).toBe("draft-abc");
		} finally {
			cleanup?.();
		}
	});

	test("gemini preset writes .gemini/settings.json with Electron binary + ELECTRON_RUN_AS_NODE=1", () => {
		const preset = CLI_PRESETS.gemini;
		const opts = fakeLaunchOpts(worktree);

		const cleanup = preset.setupMcp?.(opts);
		try {
			const configPath = join(worktree, ".gemini", "settings.json");
			const cfg = JSON.parse(readFileSync(configPath, "utf-8"));

			expect(cfg.mcpServers.superiorswarm.command).toBe(process.execPath);
			expect(cfg.mcpServers.superiorswarm.args).toEqual([opts.mcpServerPath]);
			expect(cfg.mcpServers.superiorswarm.env.ELECTRON_RUN_AS_NODE).toBe("1");
		} finally {
			cleanup?.();
		}
	});

	test("codex preset writes .codex/config.json with Electron binary + ELECTRON_RUN_AS_NODE=1", () => {
		const preset = CLI_PRESETS.codex;
		const opts = fakeLaunchOpts(worktree);

		const cleanup = preset.setupMcp?.(opts);
		try {
			const configPath = join(worktree, ".codex", "config.json");
			const cfg = JSON.parse(readFileSync(configPath, "utf-8"));

			expect(cfg.mcpServers.superiorswarm.command).toBe(process.execPath);
			expect(cfg.mcpServers.superiorswarm.args).toEqual([opts.mcpServerPath]);
			expect(cfg.mcpServers.superiorswarm.env.ELECTRON_RUN_AS_NODE).toBe("1");
		} finally {
			cleanup?.();
		}
	});

	test("opencode preset writes opencode.json with Electron binary + ELECTRON_RUN_AS_NODE=1", () => {
		const preset = CLI_PRESETS.opencode;
		const opts = fakeLaunchOpts(worktree);

		const cleanup = preset.setupMcp?.(opts);
		try {
			const configPath = join(worktree, "opencode.json");
			const cfg = JSON.parse(readFileSync(configPath, "utf-8"));

			expect(cfg.mcp.superiorswarm.command).toEqual([process.execPath, opts.mcpServerPath]);
			expect(cfg.mcp.superiorswarm.environment.ELECTRON_RUN_AS_NODE).toBe("1");
		} finally {
			cleanup?.();
		}
	});

	test("claude preset preserves pre-existing user mcp entries", () => {
		const preset = CLI_PRESETS.claude;
		const opts = fakeLaunchOpts(worktree);
		const userConfig = {
			mcpServers: { atlassian: { type: "http", url: "https://mcp.atlassian.com/v1/mcp" } },
		};
		writeFileSync(join(worktree, ".mcp.json"), JSON.stringify(userConfig, null, 2));

		const cleanup = preset.setupMcp?.(opts);
		try {
			const cfg = JSON.parse(readFileSync(join(worktree, ".mcp.json"), "utf-8"));
			expect(cfg.mcpServers.atlassian).toEqual(userConfig.mcpServers.atlassian);
			expect(cfg.mcpServers.superiorswarm).toBeDefined();
		} finally {
			cleanup?.();
		}
		const after = JSON.parse(readFileSync(join(worktree, ".mcp.json"), "utf-8"));
		expect(after.mcpServers.atlassian).toEqual(userConfig.mcpServers.atlassian);
		expect(after.mcpServers.superiorswarm).toBeUndefined();
	});

	test("opencode preset preserves unrelated user keys in opencode.json", () => {
		const preset = CLI_PRESETS.opencode;
		const opts = fakeLaunchOpts(worktree);
		const userConfig = { theme: "tokyonight", $schema: "https://opencode.ai/config.json" };
		writeFileSync(join(worktree, "opencode.json"), JSON.stringify(userConfig, null, 2));

		const cleanup = preset.setupMcp?.(opts);
		try {
			const cfg = JSON.parse(readFileSync(join(worktree, "opencode.json"), "utf-8"));
			expect(cfg.theme).toBe("tokyonight");
			expect(cfg.$schema).toBe("https://opencode.ai/config.json");
			expect(cfg.mcp.superiorswarm).toBeDefined();
		} finally {
			cleanup?.();
		}
		const after = JSON.parse(readFileSync(join(worktree, "opencode.json"), "utf-8"));
		expect(after.theme).toBe("tokyonight");
		expect(after.mcp).toBeUndefined();
	});
});

describe("MCP standalone server boot (smoke test)", () => {
	const serverPath = join(__dirname, "..", "mcp-standalone", "server.mjs");
	const electronBin = join(__dirname, "..", "node_modules", ".bin", "electron");

	test.skipIf(!existsSync(serverPath) || !existsSync(electronBin))(
		"loads better-sqlite3 under ELECTRON_RUN_AS_NODE without ABI mismatch",
		async () => {
			const dbPath = join(tmpdir(), `mcp-smoke-${process.pid}-${Date.now()}.db`);

			const child = spawn(electronBin, [serverPath], {
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					REVIEW_DRAFT_ID: "smoke-test",
					PR_METADATA: "{}",
					DB_PATH: dbPath,
				},
				stdio: ["pipe", "pipe", "pipe"],
			});

			let stderr = "";
			child.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});

			// Wait for the server to initialize OR crash — whichever comes first.
			// The event-driven race resolves immediately on crash so we don't wait
			// the full 2s on a broken binary. The 2s ceiling gives slow CI machines
			// enough time for Electron to start and hit the native-module load.
			let timer: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, 2_000);
				}),
				new Promise<void>((resolve) => child.once("exit", resolve)),
			]);
			if (timer) clearTimeout(timer);

			const crashedWithAbiError = stderr.includes("NODE_MODULE_VERSION");
			const crashedAtAll = child.exitCode !== null;

			if (!crashedAtAll) {
				child.kill("SIGTERM");
				await new Promise<void>((resolve) => child.once("exit", resolve));
			}

			rmSync(dbPath, { force: true });
			rmSync(`${dbPath}-wal`, { force: true });
			rmSync(`${dbPath}-shm`, { force: true });

			expect(crashedWithAbiError).toBe(false);
			expect(crashedAtAll).toBe(false);
		},
		10_000
	);
});
