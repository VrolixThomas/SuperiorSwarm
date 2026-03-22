CREATE TABLE `review_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`review_draft_id` text REFERENCES `review_drafts`(`id`) ON UPDATE no action ON DELETE set null,
	`worktree_id` text REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE set null,
	`project_id` text NOT NULL REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	`pr_provider` text NOT NULL,
	`pr_identifier` text NOT NULL,
	`terminal_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_workspaces_project_pr_unique` ON `review_workspaces` (`project_id`,`pr_provider`,`pr_identifier`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pane_layouts` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`layout` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_pane_layouts`("workspace_id", "layout", "updated_at") SELECT "workspace_id", "layout", "updated_at" FROM `pane_layouts`;--> statement-breakpoint
DROP TABLE `pane_layouts`;--> statement-breakpoint
ALTER TABLE `__new_pane_layouts` RENAME TO `pane_layouts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_terminal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`cwd` text NOT NULL,
	`scrollback` text,
	`sort_order` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_terminal_sessions`("id", "workspace_id", "title", "cwd", "scrollback", "sort_order", "updated_at") SELECT "id", "workspace_id", "title", "cwd", "scrollback", "sort_order", "updated_at" FROM `terminal_sessions`;--> statement-breakpoint
DROP TABLE `terminal_sessions`;--> statement-breakpoint
ALTER TABLE `__new_terminal_sessions` RENAME TO `terminal_sessions`;--> statement-breakpoint
ALTER TABLE `review_drafts` DROP COLUMN `summary_file_path`;--> statement-breakpoint
ALTER TABLE `review_drafts` DROP COLUMN `worktree_path`;
--> statement-breakpoint
DELETE FROM worktrees WHERE id IN (SELECT worktree_id FROM workspaces WHERE name LIKE 'Review: %' AND worktree_id IS NOT NULL);
--> statement-breakpoint
DELETE FROM workspaces WHERE name LIKE 'Review: %';
--> statement-breakpoint
DELETE FROM review_drafts;
--> statement-breakpoint
DELETE FROM draft_comments;