import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeTomlKey, removeTomlKey } from "../src/main/services/toml-merge";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "toml-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("toml-merge", () => {
	test("merge into missing file creates it", () => {
		const file = join(dir, "config.toml");
		mergeTomlKey(file, ["mcp_servers", "superiorswarm"], { command: "x", args: [] });
		const text = readFileSync(file, "utf-8");
		expect(text).toMatch(/\[mcp_servers\.superiorswarm\]/);
		expect(text).toMatch(/command = "x"/);
	});

	test("merge preserves sibling tables", () => {
		const file = join(dir, "config.toml");
		writeFileSync(file, '[mcp_servers.other]\ncommand = "y"\n');
		mergeTomlKey(file, ["mcp_servers", "superiorswarm"], { command: "x", args: [] });
		const text = readFileSync(file, "utf-8");
		expect(text).toMatch(/superiorswarm/);
		expect(text).toMatch(/other/);
		expect(text).toMatch(/command = "y"/);
	});

	test("remove takes back the key, leaves siblings", () => {
		const file = join(dir, "config.toml");
		writeFileSync(file, '[mcp_servers.other]\ncommand = "y"\n');
		mergeTomlKey(file, ["mcp_servers", "superiorswarm"], { command: "x", args: [] });
		removeTomlKey(file, ["mcp_servers", "superiorswarm"]);
		const text = readFileSync(file, "utf-8");
		expect(text).not.toMatch(/superiorswarm/);
		expect(text).toMatch(/other/);
	});
});
