import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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

/** A local deferral applies only to the exact source revision the user saw. */
export const activityQueueSnoozes = sqliteTable("activity_queue_snoozes", {
	sourceId: text("source_id")
		.primaryKey()
		.references(() => activityQueueSources.sourceId, { onDelete: "cascade" }),
	revision: integer("revision").notNull(),
	until: integer("until"),
	untilChange: integer("until_change", { mode: "boolean" }).notNull(),
	createdAt: integer("created_at").notNull(),
});

/** Durable intent precedes PTY admission. Uncertainty never permits automatic resubmission. */
export const activityQueueDeliveries = sqliteTable(
	"activity_queue_deliveries",
	{
		requestId: text("request_id").primaryKey(),
		mode: text("mode", { enum: ["live", "resume"] })
			.notNull()
			.default("live"),
		answerBinding: text("answer_binding", { mode: "json" }).$type<
			import("../../shared/queue-answer-continuation").QueueAnswerBinding
		>(),
		continuationTurnId: text("continuation_turn_id"),
		cleanupProtectedTurnId: text("cleanup_protected_turn_id"),
		occurrenceKey: text("occurrence_key").notNull(),
		fingerprint: text("fingerprint").notNull(),
		target: text("target", { mode: "json" })
			.$type<import("../../shared/activity-queue").ActivityQueueTarget>()
			.notNull(),
		members: text("members", { mode: "json" })
			.$type<{ id: string; revision: number }[]>()
			.notNull(),
		state: text("state", { enum: ["reserved", "uncertain", "admitted", "rejected"] }).notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		uniqueIndex("activity_queue_deliveries_active_occurrence")
			.on(table.occurrenceKey)
			.where(sql`${table.state} <> 'rejected'`),
	]
);
