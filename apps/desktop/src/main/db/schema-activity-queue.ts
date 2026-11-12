import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ActivityQueueCandidate } from "../../shared/activity-queue";

/** One atomic current projection and receipt per source; inactive baselines are retained. */
export const activityQueueSources = sqliteTable("activity_queue_sources", {
	sourceId: text("source_id").primaryKey(),
	sourceType: text("source_type").notNull(),
	snapshot: text("snapshot", { mode: "json" }).$type<unknown>().notNull(),
	fingerprint: text("fingerprint").notNull(),
	candidate: text("candidate", { mode: "json" }).$type<ActivityQueueCandidate | null>(),
	revision: integer("revision").notNull(),
	acknowledgedRevision: integer("acknowledged_revision"),
	observedAt: integer("observed_at").notNull(),
	error: text("error"),
});
