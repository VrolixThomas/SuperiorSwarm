import { describe, expect, test } from "bun:test";
import { daemonInstanceId, daemonPaths } from "../../src/shared/daemon-protocol";

describe("daemonPaths", () => {
	test("daemonInstanceId is deterministic", () => {
		const id1 = daemonInstanceId("/some/path");
		const id2 = daemonInstanceId("/some/path");
		expect(id1).toBe(id2);
	});

	test("daemonInstanceId differs for different paths", () => {
		const id1 = daemonInstanceId("/worktree/a");
		const id2 = daemonInstanceId("/worktree/b");
		expect(id1).not.toBe(id2);
	});

	test("daemonInstanceId is 12 hex chars", () => {
		const id = daemonInstanceId("/some/path");
		expect(id).toMatch(/^[0-9a-f]{12}$/);
	});

	test("daemonPaths returns scoped filenames", () => {
		const paths = daemonPaths("abc123def456");
		expect(paths.socketPath).toContain("daemon-abc123def456.sock");
		expect(paths.pidPath).toContain("daemon-abc123def456.pid");
		expect(paths.logPath).toContain("daemon-abc123def456.log");
	});
});
