CREATE TABLE `tracked_prs` (
	`provider` text NOT NULL,
	`identifier` text NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`number` integer NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`source_branch` text DEFAULT '' NOT NULL,
	`target_branch` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	`head_commit_sha` text,
	`author_login` text DEFAULT 'Unknown' NOT NULL,
	`author_avatar_url` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`state_changed_at` integer,
	`updated_at` integer NOT NULL,
	`auto_review_first_triggered_at` integer,
	`auto_review_last_triggered_sha` text,
	PRIMARY KEY(`provider`, `identifier`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_tracked_prs_project_state` ON `tracked_prs` (`project_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_tracked_prs_provider` ON `tracked_prs` (`provider`);--> statement-breakpoint
CREATE INDEX `idx_tracked_prs_last_seen` ON `tracked_prs` (`last_seen_at`);