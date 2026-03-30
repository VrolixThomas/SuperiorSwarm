import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { reviewDrafts } from "./schema-ai-review";

export const projects = sqliteTable("projects", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	repoPath: text("repo_path").notNull().unique(),
	defaultBranch: text("default_branch").notNull().default("main"),
	color: text("color"),
	githubOwner: text("github_owner"),
	githubRepo: text("github_repo"),
	status: text("status", { enum: ["cloning", "initializing", "ready", "error"] })
		.notNull()
		.default("ready"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const worktrees = sqliteTable("worktrees", {
	id: text("id").primaryKey(),
	projectId: text("project_id")
		.notNull()
		.references(() => projects.id, { onDelete: "cascade" }),
	path: text("path").notNull().unique(),
	branch: text("branch").notNull(),
	baseBranch: text("base_branch").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type Worktree = typeof worktrees.$inferSelect;
export type NewWorktree = typeof worktrees.$inferInsert;

export const workspaces = sqliteTable(
	"workspaces",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		type: text("type", { enum: ["branch", "worktree", "review"] }).notNull(),
		name: text("name").notNull(),
		worktreeId: text("worktree_id").references(() => worktrees.id, {
			onDelete: "cascade",
		}),
		terminalId: text("terminal_id"),
		prProvider: text("pr_provider"),
		prIdentifier: text("pr_identifier"),
		reviewDraftId: text("review_draft_id").references(() => reviewDrafts.id, {
			onDelete: "set null",
		}),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		uniqueIndex("workspaces_pr_unique").on(
			table.projectId,
			table.prProvider,
			table.prIdentifier,
			table.type
		),
	]
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

export const terminalSessions = sqliteTable("terminal_sessions", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id").notNull(),
	title: text("title").notNull(),
	cwd: text("cwd").notNull(),
	scrollback: text("scrollback"),
	sortOrder: integer("sort_order").notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type TerminalSession = typeof terminalSessions.$inferSelect;
export type NewTerminalSession = typeof terminalSessions.$inferInsert;

export const sessionState = sqliteTable("session_state", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

export const paneLayouts = sqliteTable("pane_layouts", {
	workspaceId: text("workspace_id").primaryKey(),
	layout: text("layout").notNull(), // JSON serialized layout tree
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type PaneLayout = typeof paneLayouts.$inferSelect;
export type NewPaneLayout = typeof paneLayouts.$inferInsert;

export const atlassianAuth = sqliteTable("atlassian_auth", {
	service: text("service", { enum: ["jira", "bitbucket"] }).primaryKey(),
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	cloudId: text("cloud_id"),
	siteUrl: text("site_url"),
	accountId: text("account_id").notNull(),
	displayName: text("display_name"),
});

export type AtlassianAuth = typeof atlassianAuth.$inferSelect;
export type NewAtlassianAuth = typeof atlassianAuth.$inferInsert;

export const diffSessions = sqliteTable("diff_sessions", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	type: text("type", { enum: ["pr", "branch", "working-tree"] }).notNull(),
	contextJson: text("context_json").notNull(),
	repoPath: text("repo_path").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export type DiffSession = typeof diffSessions.$inferSelect;
export type NewDiffSession = typeof diffSessions.$inferInsert;

export const extensionPaths = sqliteTable("extension_paths", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	path: text("path").notNull().unique(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	installedAt: integer("installed_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export type ExtensionPath = typeof extensionPaths.$inferSelect;
export type NewExtensionPath = typeof extensionPaths.$inferInsert;

export const sharedFiles = sqliteTable(
	"shared_files",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		relativePath: text("relative_path").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		uniqueIndex("shared_files_project_path_unique").on(table.projectId, table.relativePath),
	]
);

export type SharedFile = typeof sharedFiles.$inferSelect;
export type NewSharedFile = typeof sharedFiles.$inferInsert;

export const linearAuth = sqliteTable("linear_auth", {
	id: text("id").primaryKey(),
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	accountId: text("account_id").notNull(),
	displayName: text("display_name"),
});

export type LinearAuth = typeof linearAuth.$inferSelect;
export type NewLinearAuth = typeof linearAuth.$inferInsert;

export const ticketBranchLinks = sqliteTable(
	"ticket_branch_links",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		provider: text("provider", { enum: ["linear", "jira"] }).notNull(),
		ticketId: text("ticket_id").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		uniqueIndex("ticket_branch_links_workspace_provider_ticket_unique").on(
			table.workspaceId,
			table.provider,
			table.ticketId
		),
	]
);

export type TicketBranchLink = typeof ticketBranchLinks.$inferSelect;
export type NewTicketBranchLink = typeof ticketBranchLinks.$inferInsert;

export const githubAuth = sqliteTable("github_auth", {
	id: text("id").primaryKey(),
	accessToken: text("access_token").notNull(),
	accountId: text("account_id").notNull(),
	displayName: text("display_name"),
});

export type GithubAuth = typeof githubAuth.$inferSelect;
export type NewGithubAuth = typeof githubAuth.$inferInsert;

export const githubBranchPrs = sqliteTable(
	"github_branch_prs",
	{
		id: text("id").primaryKey(),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => workspaces.id, { onDelete: "cascade" }),
		prRepoOwner: text("pr_repo_owner").notNull(),
		prRepoName: text("pr_repo_name").notNull(),
		prNumber: integer("pr_number").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		uniqueIndex("github_branch_prs_workspace_pr_unique").on(
			table.workspaceId,
			table.prRepoOwner,
			table.prRepoName,
			table.prNumber
		),
	]
);

export type GithubBranchPr = typeof githubBranchPrs.$inferSelect;
export type NewGithubBranchPr = typeof githubBranchPrs.$inferInsert;

export const githubPrFileViewed = sqliteTable(
	"github_pr_file_viewed",
	{
		id: text("id").primaryKey(),
		prOwner: text("pr_owner").notNull(),
		prRepo: text("pr_repo").notNull(),
		prNumber: integer("pr_number").notNull(),
		filePath: text("file_path").notNull(),
		viewedAt: integer("viewed_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		uniqueIndex("github_pr_file_viewed_unique").on(
			table.prOwner,
			table.prRepo,
			table.prNumber,
			table.filePath
		),
	]
);

export type GithubPrFileViewed = typeof githubPrFileViewed.$inferSelect;
export type NewGithubPrFileViewed = typeof githubPrFileViewed.$inferInsert;

export const ticketCache = sqliteTable("ticket_cache", {
	id: text("id").primaryKey(), // "provider:ticketId" e.g. "jira:PI-2787"
	provider: text("provider", { enum: ["linear", "jira"] }).notNull(),
	data: text("data").notNull(), // JSON-serialized JiraIssue or LinearIssue
	groupId: text("group_id").notNull(), // projectKey or teamId
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type TicketCacheRow = typeof ticketCache.$inferSelect;

export {
	aiReviewSettings,
	type AiReviewSettings,
	type NewAiReviewSettings,
	reviewDrafts,
	type ReviewDraft,
	type NewReviewDraft,
	draftComments,
	type DraftComment,
	type NewDraftComment,
} from "./schema-ai-review";

export {
	commentSolveSessions,
	type CommentSolveSession,
	type NewCommentSolveSession,
	commentGroups,
	type CommentGroup,
	type NewCommentGroup,
	prComments,
	type PrComment,
	type NewPrComment,
	commentReplies,
	type CommentReply,
	type NewCommentReply,
} from "./schema-comment-solver";
