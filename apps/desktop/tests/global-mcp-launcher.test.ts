import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLauncherScript } from "../src/main/services/global-mcp-launcher";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "launcher-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("global-mcp-launcher", () => {
	test("writes posix script that execs electron + server", () => {
		if (process.platform === "win32") return;
		const path = writeLauncherScript(dir, "/path/to/electron", "/path/to/server.mjs");
		expect(path).toBe(join(dir, "bin", "superiorswarm-mcp"));
		const body = readFileSync(path, "utf-8");
		expect(body).toContain("ELECTRON_RUN_AS_NODE=1");
		expect(body).toContain("/path/to/electron");
		expect(body).toContain("/path/to/server.mjs");
		expect(statSync(path).mode & 0o111).not.toBe(0);
	});

	test("idempotent: rewriting with same inputs yields same content", () => {
		if (process.platform === "win32") return;
		const a = readFileSync(writeLauncherScript(dir, "/e", "/s"), "utf-8");
		const b = readFileSync(writeLauncherScript(dir, "/e", "/s"), "utf-8");
		expect(a).toBe(b);
	});

	test("escapes single quotes in paths", () => {
		if (process.platform === "win32") return;
		const path = writeLauncherScript(dir, "/o'kane/electron", "/srv.mjs");
		const body = readFileSync(path, "utf-8");
		expect(body).toMatch(/o'\\''kane/);
	});
});
