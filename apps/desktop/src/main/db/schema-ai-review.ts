import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Single-row config table for global AI review settings
export const aiReviewSettings = sqliteTable("ai_review_settings", {
	id: text("id").primaryKey(), // fixed ID, single-row table
	cliPreset: text("cli_preset").notNull().default("claude"),
	cliFlags: text("cli_flags"),
	autoReviewEnabled: integer("auto_review_enabled").notNull().default(0),
	autoReReviewOnCommit: integer("auto_re_review_on_commit").notNull().default(0),
	skipPermissions: integer("skip_permissions").notNull().default(1),
	customPrompt: text("custom_prompt"),
	maxConcurrentReviews: integer("max_concurrent_reviews").notNull().default(3),
	autoApproveResolutions: integer("auto_approve_resolutions").notNull().default(0),
	autoPublishResolutions: integer("auto_publish_resolutions").notNull().default(0),
	autoSolveEnabled: integer("auto_solve_enabled").notNull().default(0),
	solveAutoResolveThreads: integer("solve_auto_resolve_threads").notNull().default(0),
	solvePrompt: text("solve_prompt"),
	updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export type AiReviewSettings = typeof aiReviewSettings.$inferSelect;
export type NewAiReviewSettings = typeof aiReviewSettings.$inferInsert;

// One row per PR review session
export const reviewDrafts = sqliteTable("review_drafts", {
	id: text("id").primaryKey(),
	prProvider: text("pr_provider").notNull(), // "github" | "bitbucket"
	prIdentifier: text("pr_identifier").notNull(), // "owner/repo#123"
	prTitle: text("pr_title").notNull(),
	prAuthor: text("pr_author").notNull(),
	sourceBranch: text("source_branch").notNull(),
	targetBranch: text("target_branch").notNull(),
	status: text("status").notNull().default("queued"), // queued | in_progress | ready | submitted | failed | cancelled
	commitSha: text("commit_sha"),
	summaryMarkdown: text("summary_markdown"),
	reviewChainId: text("review_chain_id"),
	roundNumber: integer("round_number").notNull().default(1),
	previousDraftId: text("previous_draft_id"),
	pid: integer("pid"),
	lastActivityAt: integer("last_activity_at", { mode: "timestamp" }),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type ReviewDraft = typeof reviewDrafts.$inferSelect;
export type NewReviewDraft = typeof reviewDrafts.$inferInsert;

// Individual inline comments belonging to a review draft
export const draftComments = sqliteTable("draft_comments", {
	id: text("id").primaryKey(),
	reviewDraftId: text("review_draft_id")
		.notNull()
		.references(() => reviewDrafts.id, { onDelete: "cascade" }),
	filePath: text("file_path").notNull(),
	lineNumber: integer("line_number"),
	side: text("side"), // "LEFT" | "RIGHT"
	body: text("body").notNull(),
	status: text("status").notNull().default("pending"), // pending | approved | rejected | edited | user-pending
	userEdit: text("user_edit"),
	previousCommentId: text("previous_comment_id"),
	resolution: text("resolution"), // resolved-by-code | incorrectly-resolved | still-open | new
	resolutionReason: text("resolution_reason"),
	platformCommentId: text("platform_comment_id"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type DraftComment = typeof draftComments.$inferSelect;
export type NewDraftComment = typeof draftComments.$inferInsert;
