import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { reviewDrafts } from "./schema-ai-review";

export const projects = sqliteTable("projects", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	repoPath: text("repo_path").notNull().unique(),
	defaultBranch: text("default_branch").notNull().default("main"),
	color: text("color"),
	remoteOwner: text("remote_owner"),
	remoteRepo: text("remote_repo"),
	remoteHost: text("remote_host"),
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
	email: text("email"),
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
		type: text("type", { enum: ["file", "directory"] })
			.notNull()
			.default("file"),
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
	email: text("email"),
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
	email: text("email"),
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

export const teamMembers = sqliteTable(
	"team_members",
	{
		id: text("id").primaryKey(), // "provider:teamId:userId"
		provider: text("provider", { enum: ["linear", "jira"] }).notNull(),
		userId: text("user_id").notNull(),
		name: text("name").notNull(),
		email: text("email"),
		avatarUrl: text("avatar_url"),
		teamId: text("team_id").notNull(), // Linear teamId or Jira projectKey
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		providerTeamIdx: index("team_members_provider_team_idx").on(table.provider, table.teamId),
	})
);

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;

export const quickActions = sqliteTable("quick_actions", {
	id: text("id").primaryKey(),
	projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
	label: text("label").notNull(),
	command: text("command").notNull(),
	cwd: text("cwd"),
	shortcut: text("shortcut"),
	sortOrder: integer("sort_order").notNull().default(0),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type QuickAction = typeof quickActions.$inferSelect;
export type NewQuickAction = typeof quickActions.$inferInsert;

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
	commentEvents,
	type CommentEvent,
	type NewCommentEvent,
	prCommentCache,
	type PrCommentCache,
	type NewPrCommentCache,
	prCommentCacheMeta,
	type PrCommentCacheMeta,
	type NewPrCommentCacheMeta,
} from "./schema-comment-solver";

// ── tracked_prs ──────────────────────────────────────────────────────────────
//
// Persistent record of every PR the poller has ever observed. Replaces the
// in-memory `prCache: Map` in `pr-poller.ts`. Composite PK on
// (provider, identifier) closes a latent collision: today's identifier alone
// would conflict if the same `owner/repo#number` slug appeared on both
// providers. See docs/superpowers/specs/2026-04-07-persistent-pr-tracking-design.md.

export const trackedPrs = sqliteTable(
	"tracked_prs",
	{
		// ── Identity ────────────────────────────────────────────────────
		provider: text("provider").notNull(),
		identifier: text("identifier").notNull(),
		repoOwner: text("repo_owner").notNull(),
		repoName: text("repo_name").notNull(),
		number: integer("number").notNull(),

		// ── Local linkage (nullable: PR may exist for a repo we don't track) ──
		projectId: text("project_id").references(() => projects.id, {
			onDelete: "set null",
		}),

		// ── Last observed PR state ──────────────────────────────────────
		title: text("title").notNull(),
		state: text("state").notNull(),
		sourceBranch: text("source_branch").notNull().default(""),
		targetBranch: text("target_branch").notNull().default(""),
		role: text("role").notNull(),
		headCommitSha: text("head_commit_sha"),
		authorLogin: text("author_login").notNull().default("Unknown"),
		authorAvatarUrl: text("author_avatar_url"),

		// ── Discovery & freshness ───────────────────────────────────────
		firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
		stateChangedAt: integer("state_changed_at", { mode: "timestamp_ms" }),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),

		// ── Auto-review ledger (B-split semantics) ──────────────────────
		autoReviewFirstTriggeredAt: integer("auto_review_first_triggered_at", {
			mode: "timestamp_ms",
		}),
		autoReviewLastTriggeredSha: text("auto_review_last_triggered_sha"),
	},
	(table) => [
		primaryKey({ columns: [table.provider, table.identifier] }),
		index("idx_tracked_prs_project_state").on(table.projectId, table.state),
		index("idx_tracked_prs_provider").on(table.provider),
		index("idx_tracked_prs_last_seen").on(table.lastSeenAt),
	]
);

export type TrackedPr = typeof trackedPrs.$inferSelect;
export type NewTrackedPr = typeof trackedPrs.$inferInsert;

export const telemetryState = sqliteTable("telemetry_state", {
	id: integer("id").primaryKey(), // always 1 — singleton row
	firstLaunchAt: integer("first_launch_at", { mode: "timestamp" }).notNull(),
	firstSignedInAt: integer("first_signed_in_at", { mode: "timestamp" }),
	lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
	optOut: integer("opt_out", { mode: "boolean" }).notNull().default(false),
	lifetimeSessionsStarted: integer("lifetime_sessions_started").notNull().default(0),
	lifetimeReviewsStarted: integer("lifetime_reviews_started").notNull().default(0),
	lifetimeCommentsSolved: integer("lifetime_comments_solved").notNull().default(0),
	everConnectedGithub: integer("ever_connected_github", { mode: "boolean" })
		.notNull()
		.default(false),
	everConnectedLinear: integer("ever_connected_linear", { mode: "boolean" })
		.notNull()
		.default(false),
	everConnectedJira: integer("ever_connected_jira", { mode: "boolean" }).notNull().default(false),
	everConnectedBitbucket: integer("ever_connected_bitbucket", { mode: "boolean" })
		.notNull()
		.default(false),
});

export type TelemetryState = typeof telemetryState.$inferSelect;
export type NewTelemetryState = typeof telemetryState.$inferInsert;

export const lspTrustedRepos = sqliteTable("lsp_trusted_repos", {
	repoPath: text("repo_path").primaryKey(),
	trusted: integer("trusted", { mode: "boolean" }).notNull().default(false),
	decidedAt: integer("decided_at", { mode: "timestamp" }).notNull(),
});

export type LspTrustedRepo = typeof lspTrustedRepos.$inferSelect;

export const lspDismissedLanguages = sqliteTable("lsp_dismissed_languages", {
	language: text("language").primaryKey(),
	dismissedAt: integer("dismissed_at", { mode: "timestamp" }).notNull(),
});

export type LspDismissedLanguage = typeof lspDismissedLanguages.$inferSelect;

export const reviewViewed = sqliteTable(
	"review_viewed",
	{
		workspaceId: text("workspace_id").notNull(),
		filePath: text("file_path").notNull(),
		contentHash: text("content_hash").notNull(),
		viewedAt: integer("viewed_at", { mode: "timestamp" }).notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.workspaceId, table.filePath] }),
		index("idx_review_viewed_workspace").on(table.workspaceId),
	]
);

export type ReviewViewed = typeof reviewViewed.$inferSelect;
export type NewReviewViewed = typeof reviewViewed.$inferInsert;
