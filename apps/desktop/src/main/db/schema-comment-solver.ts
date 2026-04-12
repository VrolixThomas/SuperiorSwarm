import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { workspaces } from "./schema";

export const commentSolveSessions = sqliteTable("comment_solve_sessions", {
	id: text("id").primaryKey(),
	prProvider: text("pr_provider").notNull(),
	prIdentifier: text("pr_identifier").notNull(),
	prTitle: text("pr_title").notNull(),
	sourceBranch: text("source_branch").notNull(),
	targetBranch: text("target_branch").notNull(),
	status: text("status").notNull().default("queued"),
	commitSha: text("commit_sha"),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	pid: integer("pid"),
	lastActivityAt: integer("last_activity_at", { mode: "timestamp" }),
});

export type CommentSolveSession = typeof commentSolveSessions.$inferSelect;
export type NewCommentSolveSession = typeof commentSolveSessions.$inferInsert;

export const commentGroups = sqliteTable("comment_groups", {
	id: text("id").primaryKey(),
	solveSessionId: text("solve_session_id")
		.notNull()
		.references(() => commentSolveSessions.id, { onDelete: "cascade" }),
	label: text("label").notNull(),
	status: text("status").notNull().default("pending"),
	commitHash: text("commit_hash"),
	order: integer("order").notNull(),
});

export type CommentGroup = typeof commentGroups.$inferSelect;
export type NewCommentGroup = typeof commentGroups.$inferInsert;

export const prComments = sqliteTable(
	"pr_comments",
	{
		id: text("id").primaryKey(),
		solveSessionId: text("solve_session_id")
			.notNull()
			.references(() => commentSolveSessions.id, { onDelete: "cascade" }),
		groupId: text("group_id").references(() => commentGroups.id, { onDelete: "set null" }),
		platformCommentId: text("platform_comment_id").notNull(),
		author: text("author").notNull(),
		body: text("body").notNull(),
		filePath: text("file_path").notNull(),
		lineNumber: integer("line_number"),
		side: text("side"),
		threadId: text("thread_id"),
		status: text("status").notNull().default("open"),
		commitSha: text("commit_sha"),
	},
	(table) => [
		uniqueIndex("pr_comments_session_platform_unique").on(
			table.solveSessionId,
			table.platformCommentId
		),
	]
);

export type PrComment = typeof prComments.$inferSelect;
export type NewPrComment = typeof prComments.$inferInsert;

export const commentReplies = sqliteTable("comment_replies", {
	id: text("id").primaryKey(),
	prCommentId: text("pr_comment_id")
		.notNull()
		.references(() => prComments.id, { onDelete: "cascade" }),
	body: text("body").notNull(),
	status: text("status").notNull().default("draft"),
});

export type CommentReply = typeof commentReplies.$inferSelect;
export type NewCommentReply = typeof commentReplies.$inferInsert;

export const commentEvents = sqliteTable("comment_events", {
	id: text("id").primaryKey(),
	prProvider: text("pr_provider").notNull(),
	prIdentifier: text("pr_identifier").notNull(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	commentCount: integer("comment_count").notNull(),
	status: text("status").notNull().default("pending"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type CommentEvent = typeof commentEvents.$inferSelect;
export type NewCommentEvent = typeof commentEvents.$inferInsert;

export const prCommentCache = sqliteTable(
	"pr_comment_cache",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		platformCommentId: text("platform_comment_id").notNull(),
		author: text("author").notNull(),
		body: text("body").notNull(),
		filePath: text("file_path"),
		lineNumber: integer("line_number"),
		/** ISO 8601 string from the platform API (not a local timestamp) */
		createdAt: text("created_at").notNull(),
		fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		workspacePlatformUnique: uniqueIndex("pr_comment_cache_workspace_platform_unique").on(
			table.workspaceId,
			table.platformCommentId
		),
	})
);

export type PrCommentCache = typeof prCommentCache.$inferSelect;
export type NewPrCommentCache = typeof prCommentCache.$inferInsert;

export const prCommentCacheMeta = sqliteTable("pr_comment_cache_meta", {
	workspaceId: text("workspace_id")
		.primaryKey()
		.references(() => workspaces.id, { onDelete: "cascade" }),
	cacheKey: text("cache_key"),
	fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

export type PrCommentCacheMeta = typeof prCommentCacheMeta.$inferSelect;
export type NewPrCommentCacheMeta = typeof prCommentCacheMeta.$inferInsert;
