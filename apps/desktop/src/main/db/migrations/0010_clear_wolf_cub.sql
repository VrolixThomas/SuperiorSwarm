CREATE TABLE `ai_review_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`cli_preset` text DEFAULT 'claude' NOT NULL,
	`cli_flags` text,
	`auto_review_enabled` integer DEFAULT 0 NOT NULL,
	`max_concurrent_reviews` integer DEFAULT 3 NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `draft_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`review_draft_id` text NOT NULL,
	`file_path` text NOT NULL,
	`line_number` integer,
	`side` text,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`user_edit` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_draft_id`) REFERENCES `review_drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `review_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`pr_provider` text NOT NULL,
	`pr_identifier` text NOT NULL,
	`pr_title` text NOT NULL,
	`pr_author` text NOT NULL,
	`source_branch` text NOT NULL,
	`target_branch` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`commit_sha` text,
	`summary_markdown` text,
	`summary_file_path` text,
	`worktree_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
