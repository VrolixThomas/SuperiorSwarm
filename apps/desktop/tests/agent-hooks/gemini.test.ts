import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiConfig, mergeGeminiHooks } from "../../src/main/agent-hooks/agents/gemini";

describe("geminiConfig.mapEvent", () => {
	test("maps BeforeAgent to active", () => {
		expect(geminiConfig.mapEvent("BeforeAgent")).toBe("active");
	});

	test("maps AfterAgent to task-complete", () => {
		expect(geminiConfig.mapEvent("AfterAgent")).toBe("task-complete");
	});

	test("maps AfterTool to active", () => {
		expect(geminiConfig.mapEvent("AfterTool")).toBe("active");
	});

	test("returns null for unknown events", () => {
		expect(geminiConfig.mapEvent("SomeRandomEvent")).toBeNull();
	});
});

describe("mergeGeminiHooks", () => {
	const testDir = join(tmpdir(), `gemini-hook-test-${Date.now()}`);
	const settingsPath = join(testDir, "settings.json");

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	});

	test("creates settings.json if it does not exist", () => {
		mkdirSync(testDir, { recursive: true });
		mergeGeminiHooks(settingsPath, "test-hook-cmd");

		expect(existsSync(settingsPath)).toBe(true);
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(settings.hooks.AfterAgent).toBeDefined();
		expect(settings.hooks.AfterAgent[0].hooks[0].command).toBe("test-hook-cmd");
	});

	test("preserves existing settings", () => {
		mkdirSync(testDir, { recursive: true });
		writeFileSync(settingsPath, JSON.stringify({ theme: "dark", hooks: {} }));

		mergeGeminiHooks(settingsPath, "test-hook-cmd");

		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(settings.theme).toBe("dark");
		expect(settings.hooks.BeforeAgent).toBeDefined();
	});

	test("replaces old hooks on re-run", () => {
		mkdirSync(testDir, { recursive: true });
		const cmd =
			'AGENT_NOTIFY_AGENT="gemini" "/home/user/.agent-notify/hooks/on-event.sh" || true';
		mergeGeminiHooks(settingsPath, cmd);
		mergeGeminiHooks(settingsPath, cmd);

		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(settings.hooks.AfterAgent).toHaveLength(1);
		expect(settings.hooks.AfterAgent[0].hooks[0].command).toBe(cmd);
	});
});
