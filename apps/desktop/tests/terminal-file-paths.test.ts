import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { displayFilePath, formatFilePaths, isSafeTerminalPath } from "../src/shared/terminal-files";

describe("terminal file references", () => {
	test("preserves order and exact shell arguments without Enter", () => {
		const paths = ["/tmp/space name.mov", "/tmp/it's 雪.docx", "/tmp/-$()`;@.zip"];
		const text = formatFilePaths(paths);
		expect(text).toBe(" '/tmp/space name.mov' '/tmp/it'\\''s 雪.docx' '/tmp/-$()`;@.zip' ");
		// biome-ignore lint/suspicious/noControlCharactersInRegex: verify no controls enter the paste.
		expect(text).not.toMatch(/[\r\n\x00-\x1f\x7f-\x9f]/);
		for (const shell of ["/bin/bash", "/bin/zsh"]) {
			const result = spawnSync(shell, ["-f", "-c", `printf '%s\\0' ${text}`]);
			expect(result.status).toBe(0);
			expect(result.stdout.toString().split("\0").slice(0, -1)).toEqual(paths);
		}
	});
	test("rejects controls in the complete path including ancestors, without sanitizing identity", () => {
		for (const char of [
			"\r",
			"\n",
			"\0",
			"\t",
			"\x1b",
			"\x7f",
			"\x85",
			"\u2028",
			"\u2029",
			"\u202e",
			"\u2066",
			"\u200e",
			"\u061c",
		]) {
			const path = `/tmp/parent${char}/file.pdf`;
			expect(isSafeTerminalPath(path)).toBe(false);
			expect(() => formatFilePaths([path])).toThrow();
			expect(displayFilePath(path)).not.toContain(char);
		}
	});
	test("bounds count, path UTF-8 bytes and total paste without truncation", () => {
		expect(() => formatFilePaths([])).toThrow();
		expect(() => formatFilePaths(Array(64).fill("/tmp/a"))).not.toThrow();
		expect(() => formatFilePaths(Array(65).fill("/tmp/a"))).toThrow();
		for (const path of ["relative", "file:///tmp/a", `/tmp/${"雪".repeat(6000)}`, "/tmp/\ud800"]) {
			expect(() => formatFilePaths([path])).toThrow();
		}
		expect(() => formatFilePaths(Array(64).fill(`/tmp/${"a".repeat(600)}`))).toThrow();
	});
});
