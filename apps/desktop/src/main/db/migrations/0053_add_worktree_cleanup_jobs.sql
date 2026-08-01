CREATE TABLE `worktree_cleanup_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_path` text NOT NULL,
	`original_path` text NOT NULL,
	`original_path_identity` text,
	`staging_path` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`phase` text DEFAULT 'preparing' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`worker_id` text,
	`lease_expires_at` integer,
	`next_attempt_at` integer,
	`last_error` text,
	`path_reusable_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `worktree_cleanup_jobs_status_idx` ON `worktree_cleanup_jobs` (`status`,`next_attempt_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `worktree_cleanup_jobs_path_idx` ON `worktree_cleanup_jobs` (`original_path`,`status`);--> statement-breakpoint
CREATE INDEX `worktree_cleanup_jobs_lease_idx` ON `worktree_cleanup_jobs` (`status`,`lease_expires_at`);