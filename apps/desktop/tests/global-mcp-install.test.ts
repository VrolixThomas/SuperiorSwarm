import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cliConfigPaths,
	installEntryForCli,
	uninstallEntryForCli,
} from "../src/main/services/global-mcp-install";

let home: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "ssmi-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("global-mcp-install", () => {
	test("install adds entry to claude config", () => {
		installEntryForCli("claude", "/path/to/launcher", { home });
		const cfg = JSON.parse(readFileSync(cliConfigPaths("claude", { home }), "utf-8"));
		expect(cfg.mcpServers.superiorswarm.command).toBe("/path/to/launcher");
	});

	test("install preserves user entries in claude config", () => {
		const file = cliConfigPaths("claude", { home });
		writeFileSync(file, JSON.stringify({ mcpServers: { atlas: { command: "a" } } }));
		installEntryForCli("claude", "/launcher", { home });
		const cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg.mcpServers.atlas.command).toBe("a");
		expect(cfg.mcpServers.superiorswarm.command).toBe("/launcher");
	});

	test("uninstall removes only our entry", () => {
		const file = cliConfigPaths("claude", { home });
		writeFileSync(file, JSON.stringify({ mcpServers: { atlas: { command: "a" } } }));
		installEntryForCli("claude", "/launcher", { home });
		uninstallEntryForCli("claude", { home });
		const cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg.mcpServers?.superiorswarm).toBeUndefined();
		expect(cfg.mcpServers.atlas.command).toBe("a");
	});

	test("install for gemini uses settings.json", () => {
		installEntryForCli("gemini", "/launcher", { home });
		const cfg = JSON.parse(readFileSync(cliConfigPaths("gemini", { home }), "utf-8"));
		expect(cfg.mcpServers.superiorswarm.command).toBe("/launcher");
	});

	test("install for opencode uses mcp.superiorswarm with type:local", () => {
		installEntryForCli("opencode", "/launcher", { home });
		const cfg = JSON.parse(readFileSync(cliConfigPaths("opencode", { home }), "utf-8"));
		expect(cfg.mcp.superiorswarm.type).toBe("local");
		expect(cfg.mcp.superiorswarm.command).toEqual(["/launcher"]);
	});

	test("install for codex writes TOML", () => {
		installEntryForCli("codex", "/launcher", { home });
		const text = readFileSync(cliConfigPaths("codex", { home }), "utf-8");
		expect(text).toMatch(/\[mcp_servers\.superiorswarm\]/);
		expect(text).toMatch(/command = "\/launcher"/);
	});
});
