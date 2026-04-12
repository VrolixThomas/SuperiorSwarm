import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeOwnerFile, writeOwnerFile } from "../../src/daemon/owner-file";

const TEST_OWNER_PATH = join(tmpdir(), `superiorswarm-daemon-owner-${process.pid}.owner`);

describe("daemon owner file", () => {
	afterEach(() => {
		if (existsSync(TEST_OWNER_PATH)) {
			rmSync(TEST_OWNER_PATH);
		}
	});

	test("writeOwnerFile writes pid/startedAtMs/appDirHash payload", () => {
		const startedAtMs = Date.now();
		const payload = writeOwnerFile(TEST_OWNER_PATH, "abc123def456", process.pid, startedAtMs);

		expect(payload).not.toBeNull();
		expect(existsSync(TEST_OWNER_PATH)).toBe(true);

		const onDisk = JSON.parse(readFileSync(TEST_OWNER_PATH, "utf-8")) as {
			pid: number;
			startedAtMs: number;
			appDirHash: string;
		};
		expect(onDisk).toEqual({
			pid: process.pid,
			startedAtMs,
			appDirHash: "abc123def456",
		});
	});

	test("writeOwnerFile is backward compatible when env-derived values are missing", () => {
		expect(writeOwnerFile(undefined, "abc123def456", process.pid, Date.now())).toBeNull();
		expect(writeOwnerFile(TEST_OWNER_PATH, undefined, process.pid, Date.now())).toBeNull();
		expect(existsSync(TEST_OWNER_PATH)).toBe(false);
	});

	test("removeOwnerFile removes existing owner file", () => {
		writeOwnerFile(TEST_OWNER_PATH, "abc123def456", process.pid, Date.now());
		expect(existsSync(TEST_OWNER_PATH)).toBe(true);

		removeOwnerFile(TEST_OWNER_PATH);
		expect(existsSync(TEST_OWNER_PATH)).toBe(false);
	});

	test("removeOwnerFile is best effort", () => {
		expect(() => removeOwnerFile(TEST_OWNER_PATH)).not.toThrow();
		expect(() => removeOwnerFile(undefined)).not.toThrow();
	});
});
