import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCliInstalled, resolveCliPath } from "../src/main/ai-review/cli-presets";

describe("resolveCliPath", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `ss-cli-presets-${process.pid}-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("returns the absolute path when an executable exists in a search dir", () => {
		const exePath = join(testDir, "fake-cli");
		writeFileSync(exePath, "#!/bin/sh\necho ok\n");
		chmodSync(exePath, 0o755);

		expect(resolveCliPath("fake-cli", [testDir])).toBe(exePath);
	});

	test("returns null when the command is not found in any search dir", () => {
		expect(resolveCliPath("definitely-not-a-real-binary", [testDir])).toBeNull();
	});

	test("skips non-executable regular files", () => {
		const filePath = join(testDir, "fake-cli");
		writeFileSync(filePath, "not executable");
		chmodSync(filePath, 0o644);

		expect(resolveCliPath("fake-cli", [testDir])).toBeNull();
	});

	test("skips directories with the same name", () => {
		mkdirSync(join(testDir, "fake-cli"));

		expect(resolveCliPath("fake-cli", [testDir])).toBeNull();
	});

	test("searches multiple dirs in order and returns the first hit", () => {
		const dirA = join(testDir, "a");
		const dirB = join(testDir, "b");
		mkdirSync(dirA);
		mkdirSync(dirB);

		const exeB = join(dirB, "fake-cli");
		writeFileSync(exeB, "#!/bin/sh\n");
		chmodSync(exeB, 0o755);

		expect(resolveCliPath("fake-cli", [dirA, dirB])).toBe(exeB);
	});

	test("tolerates non-existent search dirs without throwing", () => {
		const missing = join(testDir, "does-not-exist");
		expect(() => resolveCliPath("fake-cli", [missing])).not.toThrow();
		expect(resolveCliPath("fake-cli", [missing])).toBeNull();
	});
});

describe("isCliInstalled", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `ss-cli-presets-installed-${process.pid}-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("returns true when resolveCliPath finds a match", () => {
		const exePath = join(testDir, "fake-cli");
		writeFileSync(exePath, "#!/bin/sh\n");
		chmodSync(exePath, 0o755);

		expect(isCliInstalled("fake-cli", [testDir])).toBe(true);
	});

	test("returns false when no match is found", () => {
		expect(isCliInstalled("definitely-not-a-real-binary", [testDir])).toBe(false);
	});
});
