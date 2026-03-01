import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
