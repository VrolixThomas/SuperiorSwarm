import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../src/main/db/schema";
import { ensureTelemetryState, getTelemetryState } from "../src/main/telemetry/state";

function freshDb() {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: join(__dirname, "../src/main/db/migrations") });
	return db;
}

describe("telemetry state bootstrap", () => {
	test("ensureTelemetryState creates a row with firstLaunchAt set and opt_out false", () => {
		const db = freshDb();
		// SQLite `timestamp` mode stores Unix seconds (floor); floor before/after to match.
		const before = Math.floor(Date.now() / 1000) * 1000;
		ensureTelemetryState(db);
		const after = Date.now();

		const state = getTelemetryState(db);
		expect(state).not.toBeNull();
		expect(state!.id).toBe(1);
		expect(state!.firstLaunchAt.getTime()).toBeGreaterThanOrEqual(before);
		expect(state!.firstLaunchAt.getTime()).toBeLessThanOrEqual(after);
		expect(state!.optOut).toBe(false);
		expect(state!.consentAcknowledgedAt).toBeNull();
		expect(state!.lifetimeSessionsStarted).toBe(0);
	});

	test("ensureTelemetryState is idempotent — does not overwrite existing row", () => {
		const db = freshDb();
		ensureTelemetryState(db);
		const first = getTelemetryState(db)!;
		// Wait a tick so any re-insert would have a later firstLaunchAt
		const sleepMs = 5;
		const wakeAt = Date.now() + sleepMs;
		while (Date.now() < wakeAt) {}
		ensureTelemetryState(db);
		const second = getTelemetryState(db)!;
		expect(second.firstLaunchAt.getTime()).toBe(first.firstLaunchAt.getTime());
	});
});
