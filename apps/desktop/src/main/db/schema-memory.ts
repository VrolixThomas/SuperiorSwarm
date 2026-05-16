import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { projects } from "./schema";

export const memoryGoals = sqliteTable(
	"memory_goals",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		body: text("body"),
		status: text("status", { enum: ["active", "done", "abandoned"] })
			.notNull()
			.default("active"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [index("memory_goals_project_status_idx").on(t.projectId, t.status)]
);

export type MemoryGoal = typeof memoryGoals.$inferSelect;
export type NewMemoryGoal = typeof memoryGoals.$inferInsert;

export const memoryFollowups = sqliteTable(
	"memory_followups",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		goalId: text("goal_id").references(() => memoryGoals.id, {
			onDelete: "set null",
		}),
		title: text("title").notNull(),
		body: text("body"),
		owner: text("owner"),
		dueAt: integer("due_at", { mode: "timestamp" }),
		status: text("status", { enum: ["open", "done", "cancelled"] })
			.notNull()
			.default("open"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [
		index("memory_followups_project_status_idx").on(t.projectId, t.status),
		index("memory_followups_project_due_idx").on(t.projectId, t.dueAt),
	]
);

export type MemoryFollowup = typeof memoryFollowups.$inferSelect;
export type NewMemoryFollowup = typeof memoryFollowups.$inferInsert;

export const memoryDecisions = sqliteTable(
	"memory_decisions",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		rationale: text("rationale").notNull(),
		alternatives: text("alternatives"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(t) => [index("memory_decisions_project_idx").on(t.projectId, t.createdAt)]
);

export type MemoryDecision = typeof memoryDecisions.$inferSelect;
export type NewMemoryDecision = typeof memoryDecisions.$inferInsert;

export const memoryOpenQuestions = sqliteTable(
	"memory_open_questions",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		question: text("question").notNull(),
		context: text("context"),
		status: text("status", { enum: ["open", "answered", "stale"] })
			.notNull()
			.default("open"),
		answer: text("answer"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		answeredAt: integer("answered_at", { mode: "timestamp" }),
	},
	(t) => [
		index("memory_questions_project_status_idx").on(t.projectId, t.status),
	]
);

export type MemoryOpenQuestion = typeof memoryOpenQuestions.$inferSelect;
export type NewMemoryOpenQuestion = typeof memoryOpenQuestions.$inferInsert;

export const memoryJournal = sqliteTable(
	"memory_journal",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		sessionId: text("session_id").notNull(),
		filePath: text("file_path").notNull(),
		summary: text("summary"),
		startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
		endedAt: integer("ended_at", { mode: "timestamp" }),
	},
	(t) => [index("memory_journal_project_idx").on(t.projectId, t.startedAt)]
);

export type MemoryJournalEntry = typeof memoryJournal.$inferSelect;
export type NewMemoryJournalEntry = typeof memoryJournal.$inferInsert;
