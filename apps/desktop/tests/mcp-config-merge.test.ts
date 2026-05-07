import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpConfigParseError, mergeKey, removeKey } from "../src/main/ai-review/mcp-config-merge";

describe("mcp-config-merge", () => {
	let dir: string;

	beforeEach(() => {
		dir = join(tmpdir(), `ss-mcp-merge-${process.pid}-${Date.now()}-${Math.random()}`);
		mkdirSync(dir, { recursive: true });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("merge into non-existent file creates file with our key", () => {
		const file = join(dir, ".mcp.json");
		const state = mergeKey(file, ["mcpServers", "superiorswarm"], { command: "x" });
		expect(state.fileExistedBefore).toBe(false);
		const cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg).toEqual({ mcpServers: { superiorswarm: { command: "x" } } });
	});

	test("merge into file with user entry preserves user entry", () => {
		const file = join(dir, ".mcp.json");
		writeFileSync(
			file,
			JSON.stringify({ mcpServers: { atlassian: { type: "http", url: "u" } } }, null, 2)
		);
		mergeKey(file, ["mcpServers", "superiorswarm"], { command: "x" });
		const cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg.mcpServers.atlassian).toEqual({ type: "http", url: "u" });
		expect(cfg.mcpServers.superiorswarm).toEqual({ command: "x" });
	});

	test("merge then remove restores byte-equivalent file when no edits between", () => {
		const file = join(dir, ".mcp.json");
		const original = JSON.stringify(
			{ mcpServers: { atlassian: { type: "http", url: "u" } } },
			null,
			2
		);
		writeFileSync(file, `${original}\n`);
		const state = mergeKey(file, ["mcpServers", "superiorswarm"], { command: "x" });
		removeKey(file, ["mcpServers", "superiorswarm"], state);
		expect(readFileSync(file, "utf-8")).toBe(`${original}\n`);
	});

	test("remove keeps user entries intact", () => {
		const file = join(dir, ".mcp.json");
		writeFileSync(
			file,
			JSON.stringify(
				{
					mcpServers: {
						atlassian: { type: "http", url: "u" },
						superiorswarm: { command: "x" },
					},
				},
				null,
				2
			)
		);
		removeKey(file, ["mcpServers", "superiorswarm"], {
			fileExistedBefore: true,
			dirExistedBefore: true,
		});
		const cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg.mcpServers.atlassian).toEqual({ type: "http", url: "u" });
		expect(cfg.mcpServers.superiorswarm).toBeUndefined();
	});

	test("remove deletes file when we created it and only our key remained", () => {
		const file = join(dir, ".mcp.json");
		const state = mergeKey(file, ["mcpServers", "superiorswarm"], { command: "x" });
		removeKey(file, ["mcpServers", "superiorswarm"], state);
		expect(existsSync(file)).toBe(false);
	});

	test("remove keeps file when we did not create it even if empty after", () => {
		const file = join(dir, ".mcp.json");
		writeFileSync(file, JSON.stringify({ mcpServers: { superiorswarm: { command: "x" } } }));
		removeKey(file, ["mcpServers", "superiorswarm"], {
			fileExistedBefore: true,
			dirExistedBefore: true,
		});
		expect(existsSync(file)).toBe(true);
		const cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg).toEqual({});
	});

	test("remove deletes empty parent object when only our key was under it", () => {
		const file = join(dir, ".mcp.json");
		writeFileSync(
			file,
			JSON.stringify({
				someUserKey: 1,
				mcpServers: { superiorswarm: { command: "x" } },
			})
		);
		removeKey(file, ["mcpServers", "superiorswarm"], {
			fileExistedBefore: true,
			dirExistedBefore: true,
		});
		const cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg).toEqual({ someUserKey: 1 });
	});

	test("indent preserved (4-space file stays 4-space)", () => {
		const file = join(dir, ".mcp.json");
		writeFileSync(file, JSON.stringify({ mcpServers: { atlassian: { url: "u" } } }, null, 4));
		mergeKey(file, ["mcpServers", "superiorswarm"], { command: "x" });
		const text = readFileSync(file, "utf-8");
		expect(text).toContain('    "mcpServers"');
	});

	test("indent preserved (tab file stays tab)", () => {
		const file = join(dir, ".mcp.json");
		writeFileSync(file, JSON.stringify({ mcpServers: { atlassian: { url: "u" } } }, null, "\t"));
		mergeKey(file, ["mcpServers", "superiorswarm"], { command: "x" });
		const text = readFileSync(file, "utf-8");
		expect(text).toContain('\t"mcpServers"');
	});

	test("invalid JSON throws McpConfigParseError and leaves file untouched", () => {
		const file = join(dir, ".mcp.json");
		const original = "{ this is not json";
		writeFileSync(file, original);
		expect(() => mergeKey(file, ["mcpServers", "superiorswarm"], { command: "x" })).toThrow(
			McpConfigParseError
		);
		expect(readFileSync(file, "utf-8")).toBe(original);
	});

	test("merge tracks dir existence and remove deletes dir we created", () => {
		const subdir = join(dir, ".gemini");
		const file = join(subdir, "settings.json");
		const state = mergeKey(file, ["mcpServers", "superiorswarm"], { command: "x" });
		expect(state.dirExistedBefore).toBe(false);
		expect(existsSync(subdir)).toBe(true);
		removeKey(file, ["mcpServers", "superiorswarm"], state);
		expect(existsSync(subdir)).toBe(false);
	});

	test("nested keypath collapses empty parent (mcp.superiorswarm)", () => {
		const file = join(dir, "opencode.json");
		writeFileSync(file, JSON.stringify({ otherUserKey: true }));
		const state = mergeKey(file, ["mcp", "superiorswarm"], { command: "x" });
		expect(state.fileExistedBefore).toBe(true);
		removeKey(file, ["mcp", "superiorswarm"], state);
		const cfg = JSON.parse(readFileSync(file, "utf-8"));
		expect(cfg).toEqual({ otherUserKey: true });
	});
});
