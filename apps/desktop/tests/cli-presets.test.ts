import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
		"loads better-sqlite3 before failing closed without app discovery",
		async () => {
			const userDataDir = mkdtempSync(join(tmpdir(), "mcp-smoke-user-data-"));
			const child = spawn(electronBin, [serverPath], {
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					SUPERIORSWARM_USER_DATA: userDataDir,
				},
				stdio: ["pipe", "pipe", "pipe"],
			});

			let stderr = "";
			child.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});
			await Promise.race([
				new Promise<void>((resolve) => child.once("exit", resolve)),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("MCP server did not fail closed")), 2_000)
				),
			]);
			rmSync(userDataDir, { force: true, recursive: true });

			expect(stderr).not.toContain("NODE_MODULE_VERSION");
			expect(stderr).toContain("SuperiorSwarm is not running (no control.json)");
			expect(child.exitCode).toBe(1);
		},
		10_000
	);
});
