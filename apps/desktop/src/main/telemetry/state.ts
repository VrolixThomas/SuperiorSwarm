import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

export function ensureTelemetryState(db: Db): void {
	const existing = db
		.select()
		.from(schema.telemetryState)
		.where(eq(schema.telemetryState.id, 1))
		.get();
	if (existing) return;
	db.insert(schema.telemetryState)
		.values({
			id: 1,
			firstLaunchAt: new Date(),
			optOut: false,
			lifetimeSessionsStarted: 0,
			lifetimeReviewsStarted: 0,
			lifetimeCommentsSolved: 0,
		})
		.run();
}

export function getTelemetryState(db: Db): schema.TelemetryState | null {
	return (
		db.select().from(schema.telemetryState).where(eq(schema.telemetryState.id, 1)).get() ?? null
	);
}

export function markFirstSignedIn(db: Db): void {
	const row = getTelemetryState(db);
	if (!row || row.firstSignedInAt) return;
	db.update(schema.telemetryState)
		.set({ firstSignedInAt: new Date() })
		.where(eq(schema.telemetryState.id, 1))
		.run();
}

export function setConsent(db: Db, optOut: boolean): void {
	db.update(schema.telemetryState)
		.set({ consentAcknowledgedAt: new Date(), optOut })
		.where(eq(schema.telemetryState.id, 1))
		.run();
}

export function setOptOut(db: Db, optOut: boolean): void {
	db.update(schema.telemetryState).set({ optOut }).where(eq(schema.telemetryState.id, 1)).run();
}

export function markSynced(db: Db): void {
	db.update(schema.telemetryState)
		.set({ lastSyncedAt: new Date() })
		.where(eq(schema.telemetryState.id, 1))
		.run();
}

type CounterKey = "lifetimeSessionsStarted" | "lifetimeReviewsStarted" | "lifetimeCommentsSolved";

export function incrementCounter(db: Db, key: CounterKey): void {
	try {
		const row = getTelemetryState(db);
		if (!row) return;
		db.update(schema.telemetryState)
			.set({ [key]: row[key] + 1 })
			.where(eq(schema.telemetryState.id, 1))
			.run();
	} catch {
		// Counters are fire-and-forget — never let telemetry break a user action
	}
}
