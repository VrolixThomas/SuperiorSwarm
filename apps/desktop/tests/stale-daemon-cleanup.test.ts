import { describe, expect, test } from "bun:test";

describe("stale daemon detection", () => {
	test("identifies stale PID files where process is dead", () => {
		const isProcessAlive = (pid: number): boolean => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		};

		// PID 999999999 almost certainly doesn't exist
		expect(isProcessAlive(999999999)).toBe(false);
		// PID of current process should be alive
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	test("identifies daemon instance IDs from PID filenames", () => {
		const filename = "daemon-a389bc298ad4.pid";
		const match = filename.match(/^daemon-([a-f0-9]+)\.pid$/);
		expect(match).not.toBeNull();
		expect(match![1]).toBe("a389bc298ad4");
	});

	test("skips own daemon instance", () => {
		const ownInstanceId = "b160c16a0734";
		const allInstances = ["a389bc298ad4", "b160c16a0734", "1275e76872a0"];
		const stale = allInstances.filter((id) => id !== ownInstanceId);
		expect(stale).toEqual(["a389bc298ad4", "1275e76872a0"]);
		expect(stale).not.toContain(ownInstanceId);
	});
});
