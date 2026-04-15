import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexConfig, mergeCodexHooks } from "../../src/main/agent-hooks/agents/codex";

describe("codexConfig.mapEvent", () => {
	test("maps SessionStart to active", () => {
		expect(codexConfig.mapEvent("SessionStart")).toBe("active");
	});

	test("maps Stop to task-complete", () => {
		expect(codexConfig.mapEvent("Stop")).toBe("task-complete");
	});

	test("returns null for unknown events", () => {
		expect(codexConfig.mapEvent("SomeRandomEvent")).toBeNull();
	});
});

describe("mergeCodexHooks", () => {
	const testDir = join(tmpdir(), `codex-hook-test-${Date.now()}`);
	const settingsPath = join(testDir, "hooks.json");

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	});

	test("creates hooks.json if it does not exist", () => {
		mkdirSync(testDir, { recursive: true });
		mergeCodexHooks(settingsPath, "test-hook-cmd");

		expect(existsSync(settingsPath)).toBe(true);
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(settings.hooks.Stop).toBeDefined();
		expect(settings.hooks.Stop[0].hooks[0].command).toBe("test-hook-cmd");
	});

	test("preserves existing settings", () => {
		mkdirSync(testDir, { recursive: true });
		writeFileSync(settingsPath, JSON.stringify({ model: "gpt-4", hooks: {} }));

		mergeCodexHooks(settingsPath, "test-hook-cmd");

		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(settings.model).toBe("gpt-4");
		expect(settings.hooks.SessionStart).toBeDefined();
	});

	test("replaces old hooks on re-run", () => {
		mkdirSync(testDir, { recursive: true });
		const cmd = 'AGENT_NOTIFY_AGENT="codex" "/home/user/.agent-notify/hooks/on-event.sh" || true';
		mergeCodexHooks(settingsPath, cmd);
		mergeCodexHooks(settingsPath, cmd);

		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(settings.hooks.Stop).toHaveLength(1);
		expect(settings.hooks.Stop[0].hooks[0].command).toBe(cmd);
	});
});
