import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CLI_PRESETS } from "../src/main/ai-review/cli-presets";

describe("CLI presets", () => {
	test("all presets have name, label, command, and buildArgs", () => {
		for (const [key, preset] of Object.entries(CLI_PRESETS)) {
			expect(preset.name).toBe(key);
			expect(typeof preset.label).toBe("string");
			expect(typeof preset.command).toBe("string");
			expect(typeof preset.buildArgs).toBe("function");
		}
	});

	test("no preset has setupMcp", () => {
		for (const preset of Object.values(CLI_PRESETS)) {
			expect("setupMcp" in preset).toBe(false);
		}
	});

	test("claude preset buildArgs includes promptFilePath", () => {
		const preset = CLI_PRESETS.claude;
		const args = preset.buildArgs({
			mcpServerPath: "/fake/server.mjs",
			worktreePath: "/fake/wt",
			reviewDir: "/fake/wt/.reviews/abc",
			promptFilePath: "/fake/wt/.reviews/abc/prompt.txt",
			dbPath: "/fake/db.sqlite",
			reviewDraftId: "draft-abc",
			prMetadata: JSON.stringify({ title: "Test PR" }),
		});
		expect(args.join(" ")).toContain("/fake/wt/.reviews/abc/prompt.txt");
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
