CREATE TABLE `comment_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`solve_session_id` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`commit_hash` text,
	`order` integer NOT NULL,
	FOREIGN KEY (`solve_session_id`) REFERENCES `comment_solve_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comment_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`pr_comment_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	FOREIGN KEY (`pr_comment_id`) REFERENCES `pr_comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `comment_solve_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`pr_provider` text NOT NULL,
	`pr_identifier` text NOT NULL,
	`pr_title` text NOT NULL,
	`source_branch` text NOT NULL,
	`target_branch` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`commit_sha` text,
	`workspace_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pr_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`solve_session_id` text NOT NULL,
	`group_id` text,
	`platform_comment_id` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`file_path` text NOT NULL,
	`line_number` integer,
	`side` text,
	`thread_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`commit_sha` text,
	FOREIGN KEY (`solve_session_id`) REFERENCES `comment_solve_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `comment_groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pr_comments_session_platform_unique` ON `pr_comments` (`solve_session_id`,`platform_comment_id`);--> statement-breakpoint
DROP INDEX `workspaces_pr_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_pr_unique` ON `workspaces` (`project_id`,`pr_provider`,`pr_identifier`,`type`);--> statement-breakpoint
ALTER TABLE `ai_review_settings` ADD `auto_solve_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_review_settings` ADD `solve_prompt` text;