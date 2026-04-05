// tests/agent-hooks/claude.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeConfig, mergeClaudeHooks } from "../../src/main/agent-hooks/agents/claude";

describe("claudeConfig.mapEvent", () => {
	test("maps UserPromptSubmit to active", () => {
		expect(claudeConfig.mapEvent("UserPromptSubmit")).toBe("active");
	});

	test("maps PostToolUse to active", () => {
		expect(claudeConfig.mapEvent("PostToolUse")).toBe("active");
	});

	test("maps Stop to task-complete", () => {
		expect(claudeConfig.mapEvent("Stop")).toBe("task-complete");
	});

	test("maps PermissionRequest to needs-input", () => {
		expect(claudeConfig.mapEvent("PermissionRequest")).toBe("needs-input");
	});

	test("returns null for unknown events", () => {
		expect(claudeConfig.mapEvent("SomeRandomEvent")).toBeNull();
	});
});

describe("mergeClaudeHooks", () => {
	const testDir = join(tmpdir(), `claude-hook-test-${Date.now()}`);
	const settingsPath = join(testDir, "settings.json");

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	});

	test("creates settings.json if it does not exist", async () => {
		mkdirSync(testDir, { recursive: true });
		await mergeClaudeHooks(settingsPath, "test-hook-cmd");

		expect(existsSync(settingsPath)).toBe(true);
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(settings.hooks.Stop).toBeDefined();
		expect(settings.hooks.Stop[0].hooks[0].command).toBe("test-hook-cmd");
	});

	test("preserves existing non-hook settings", async () => {
		mkdirSync(testDir, { recursive: true });
		writeFileSync(settingsPath, JSON.stringify({ theme: "dark", hooks: {} }));

		await mergeClaudeHooks(settingsPath, "test-hook-cmd");

		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(settings.theme).toBe("dark");
		expect(settings.hooks.Stop).toBeDefined();
	});

	test("replaces old agent-notify hooks on re-run", async () => {
		mkdirSync(testDir, { recursive: true });
		await mergeClaudeHooks(settingsPath, "old-cmd");
		await mergeClaudeHooks(settingsPath, "new-cmd");

		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		const stopHooks = settings.hooks.Stop;
		// Should only have one entry, not duplicates
		expect(stopHooks).toHaveLength(1);
		expect(stopHooks[0].hooks[0].command).toBe("new-cmd");
	});
});
