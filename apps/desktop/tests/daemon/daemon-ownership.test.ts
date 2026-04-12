import { describe, expect, test } from "bun:test";
import { isPidAlive, parseOwnerRecord } from "../../src/main/terminal/daemon-ownership";

describe("daemon ownership", () => {
	test("parseOwnerRecord returns parsed record for valid JSON", () => {
		const parsed = parseOwnerRecord(
			JSON.stringify({
				pid: process.pid,
				startedAtMs: Date.now(),
				appDirHash: "abc123def456",
			})
		);

		expect(parsed).toEqual({
			pid: process.pid,
			startedAtMs: expect.any(Number),
			appDirHash: "abc123def456",
		});
	});

	test("parseOwnerRecord returns null for malformed data", () => {
		expect(parseOwnerRecord("not-json")).toBeNull();
		expect(
			parseOwnerRecord(
				JSON.stringify({ pid: "1", startedAtMs: Date.now(), appDirHash: "abc123def456" })
			)
		).toBeNull();
		expect(parseOwnerRecord(JSON.stringify({ pid: 1, appDirHash: "abc123def456" }))).toBeNull();
		expect(
			parseOwnerRecord(JSON.stringify({ pid: 1, startedAtMs: 0, appDirHash: "abc123def456" }))
		).toBeNull();
		expect(parseOwnerRecord(JSON.stringify({ pid: 1, appDirHash: "" }))).toBeNull();
	});

	test("isPidAlive returns true for current process and false for invalid pid", () => {
		expect(isPidAlive(process.pid)).toBe(true);
		expect(isPidAlive(0)).toBe(false);
	});

	test("isPidAlive treats EPERM as alive", () => {
		const alive = isPidAlive(process.pid, () => {
			const err = new Error("permission denied") as NodeJS.ErrnoException;
			err.code = "EPERM";
			throw err;
		});

		expect(alive).toBe(true);
	});

	test("isPidAlive treats ESRCH as dead", () => {
		const alive = isPidAlive(process.pid, () => {
			const err = new Error("no such process") as NodeJS.ErrnoException;
			err.code = "ESRCH";
			throw err;
		});

		expect(alive).toBe(false);
	});
});
