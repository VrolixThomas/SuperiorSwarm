import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { ensureTelemetryState, getTelemetryState } from "../src/main/telemetry/state";
import { makeTestDb } from "./test-db";

describe("telemetry state bootstrap", () => {
	test("ensureTelemetryState creates a row with firstLaunchAt set and opt_out false", () => {
		const db = makeTestDb();
		const before = Math.floor(Date.now() / 1000) * 1000;
		ensureTelemetryState(db);
		const after = Date.now();

		const state = getTelemetryState(db);
		expect(state).not.toBeNull();
		expect(state?.id).toBe(1);
		expect(state?.firstLaunchAt.getTime()).toBeGreaterThanOrEqual(before);
		expect(state?.firstLaunchAt.getTime()).toBeLessThanOrEqual(after);
		expect(state?.optOut).toBe(false);
		expect(state?.lifetimeSessionsStarted).toBe(0);
	});

	test("ensureTelemetryState is idempotent — does not overwrite existing row", async () => {
		const db = makeTestDb();
		ensureTelemetryState(db);
		const first = getTelemetryState(db);
		await Bun.sleep(5);
		ensureTelemetryState(db);
		const second = getTelemetryState(db);
		expect(second?.firstLaunchAt.getTime()).toBe(first?.firstLaunchAt.getTime());
	});
});
