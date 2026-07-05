import { describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPidFile, removeFiles } from "../../src/main/terminal/stale-daemon-cleanup";

// Single source of truth for pid-file parsing: daemon-client's stale-restart
// path and startup cleanup must agree on what counts as a valid pid.
describe("readPidFile", () => {
	const pidPath = join(tmpdir(), `ss-pidfile-test-${process.pid}.pid`);

	function withPidFile(content: string, fn: () => void): void {
		writeFileSync(pidPath, content);
		try {
			fn();
		} finally {
			rmSync(pidPath, { force: true });
		}
	}

	test("parses a valid pid with surrounding whitespace", () => {
		withPidFile(" 12345\n", () => {
			expect(readPidFile(pidPath)).toBe(12345);
		});
	});

	test("returns null for zero", () => {
		withPidFile("0\n", () => {
			expect(readPidFile(pidPath)).toBeNull();
		});
	});

	test("returns null for negative and non-integer values", () => {
		withPidFile("-5", () => {
			expect(readPidFile(pidPath)).toBeNull();
		});
		withPidFile("123.5", () => {
			expect(readPidFile(pidPath)).toBeNull();
		});
	});

	test("returns null for garbage content", () => {
		withPidFile("not-a-pid", () => {
			expect(readPidFile(pidPath)).toBeNull();
		});
	});

	test("returns null when the file does not exist", () => {
		expect(readPidFile(join(tmpdir(), `ss-pidfile-missing-${process.pid}.pid`))).toBeNull();
	});
});

describe("removeFiles", () => {
	test("removes existing files and ignores missing ones", () => {
		const present = join(tmpdir(), `ss-rm-present-${process.pid}`);
		const missing = join(tmpdir(), `ss-rm-missing-${process.pid}`);
		writeFileSync(present, "x");

		expect(() => removeFiles(present, missing)).not.toThrow();
		expect(existsSync(present)).toBe(false);
	});
});
