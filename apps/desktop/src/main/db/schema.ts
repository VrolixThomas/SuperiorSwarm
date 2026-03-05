import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const workspaces = sqliteTable("workspaces", {
	id: text("id").primaryKey(),
	projectId: text("project_id")
		.notNull()
		.references(() => projects.id, { onDelete: "cascade" }),
	type: text("type", { enum: ["branch", "worktree"] }).notNull(),
	name: text("name").notNull(),
	worktreeId: text("worktree_id").references(() => worktrees.id, {
		onDelete: "cascade",
	}),
	terminalId: text("terminal_id"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

export const terminalSessions = sqliteTable("terminal_sessions", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id")
		.notNull()
		.references(() => workspaces.id, { onDelete: "cascade" }),
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
