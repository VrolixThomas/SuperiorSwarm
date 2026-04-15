import { eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/better-sqlite3";
import log from "electron-log/main.js";
import * as schema from "../db/schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const singleton = eq(schema.telemetryState.id, 1);

function updateSingleton(db: Db, set: Partial<schema.NewTelemetryState>): void {
	db.update(schema.telemetryState).set(set).where(singleton).run();
}

export function ensureTelemetryState(db: Db): void {
	db.insert(schema.telemetryState)
		.values({
			id: 1,
			firstLaunchAt: new Date(),
			optOut: false,
			lifetimeSessionsStarted: 0,
			lifetimeReviewsStarted: 0,
			lifetimeCommentsSolved: 0,
		})
		.onConflictDoNothing()
		.run();
}

export function getTelemetryState(db: Db): schema.TelemetryState | null {
	return db.select().from(schema.telemetryState).where(singleton).get() ?? null;
}

export function markFirstSignedIn(db: Db): void {
	const row = getTelemetryState(db);
	if (!row || row.firstSignedInAt) return;
	updateSingleton(db, { firstSignedInAt: new Date() });
}

export function setAnalyticsEnabled(db: Db, enabled: boolean): void {
	updateSingleton(db, { optOut: !enabled });
}

export function markSynced(db: Db): void {
	updateSingleton(db, { lastSyncedAt: new Date() });
}

type CounterKey = "lifetimeSessionsStarted" | "lifetimeReviewsStarted" | "lifetimeCommentsSolved";

export function incrementCounter(db: Db, key: CounterKey): void {
	try {
		const column = schema.telemetryState[key];
		updateSingleton(db, { [key]: sql`${column} + 1` });
	} catch (err) {
		log.debug("[telemetry] incrementCounter failed:", err);
	}
}
