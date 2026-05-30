import { describe, expect, test } from "bun:test";
import { buildWatchdogArgs } from "../src/main/process-watchdog";

describe("buildWatchdogArgs", () => {
	test("passes the entry script, target pid, and delay as strings", () => {
		const args = buildWatchdogArgs("/x/out/main/process-watchdog-entry.js", 4242, 5000);
		expect(args).toEqual(["/x/out/main/process-watchdog-entry.js", "4242", "5000"]);
	});
});
