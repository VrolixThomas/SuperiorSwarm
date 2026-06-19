import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	installEntryToConfig,
	uninstallEntryFromConfig,
} from "../src/main/services/global-mcp-install";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ssmc-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("installEntryToConfig", () => {
	test("json writes mcpServers.superiorswarm", () => {
		const file = join(dir, "mcp.json");
		installEntryToConfig(file, "json", "/launcher");
		const cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg.mcpServers.superiorswarm.command).toBe("/launcher");
	});

	test("json preserves sibling keys and uninstall removes only ours", () => {
		const file = join(dir, "mcp.json");
		writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: "x" } } }));
		installEntryToConfig(file, "json", "/launcher");
		let cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg.mcpServers.other.command).toBe("x");
		expect(cfg.mcpServers.superiorswarm.command).toBe("/launcher");
		uninstallEntryFromConfig(file, "json");
		cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg.mcpServers.superiorswarm).toBeUndefined();
		expect(cfg.mcpServers.other.command).toBe("x");
	});

	test("toml writes mcp_servers.superiorswarm", () => {
		const file = join(dir, "config.toml");
		installEntryToConfig(file, "toml", "/launcher");
		const text = readFileSync(file, "utf-8");
		expect(text).toMatch(/\[mcp_servers\.superiorswarm\]/);
		expect(text).toMatch(/command = "\/launcher"/);
	});

	test("opencode writes mcp.superiorswarm with type local", () => {
		const file = join(dir, "opencode.json");
		installEntryToConfig(file, "opencode", "/launcher");
		const cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg.mcp.superiorswarm.type).toBe("local");
		expect(cfg.mcp.superiorswarm.command).toEqual(["/launcher"]);
	});
});
