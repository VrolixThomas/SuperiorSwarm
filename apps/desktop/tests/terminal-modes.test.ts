import { describe, expect, test } from "bun:test";
import { RESET_STALE_MODES, isShellProcess } from "../src/shared/lib/terminal-modes";

describe("RESET_STALE_MODES", () => {
	test("disables all mouse tracking modes", () => {
		for (const mode of ["9", "1000", "1002", "1003", "1005", "1006", "1015", "1016"]) {
			expect(RESET_STALE_MODES).toContain(`\x1b[?${mode}l`);
		}
	});

	test("disables focus reporting and shows cursor", () => {
		expect(RESET_STALE_MODES).toContain("\x1b[?1004l");
		expect(RESET_STALE_MODES).toContain("\x1b[?25h");
	});

	test("does not touch bracketed paste or alt screen", () => {
		// zsh arms 2004 per-prompt; alt-screen exit is conditional (see Terminal.tsx)
		expect(RESET_STALE_MODES).not.toContain("2004");
		expect(RESET_STALE_MODES).not.toContain("1049");
	});
});

describe("isShellProcess", () => {
	test("recognizes common shells", () => {
		for (const sh of ["zsh", "bash", "fish", "sh", "dash", "nu", "pwsh", "tcsh", "csh", "ksh"]) {
			expect(isShellProcess(sh)).toBe(true);
		}
	});

	test("handles login-shell dash prefix and full paths", () => {
		expect(isShellProcess("-zsh")).toBe(true);
		expect(isShellProcess("/bin/zsh")).toBe(true);
		expect(isShellProcess("/usr/local/bin/fish")).toBe(true);
	});

	test("rejects TUI apps and empty input", () => {
		expect(isShellProcess("claude")).toBe(false);
		expect(isShellProcess("vim")).toBe(false);
		expect(isShellProcess("node")).toBe(false);
		expect(isShellProcess("")).toBe(false);
		expect(isShellProcess(undefined)).toBe(false);
	});
});
