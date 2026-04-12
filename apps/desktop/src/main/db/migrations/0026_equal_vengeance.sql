CREATE TABLE `pr_comment_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`platform_comment_id` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`file_path` text,
	`line_number` integer,
	`created_at` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pr_comment_cache_meta` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`cache_key` text,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `comment_solve_sessions` ADD `pid` integer;--> statement-breakpoint
ALTER TABLE `comment_solve_sessions` ADD `last_activity_at` integer;