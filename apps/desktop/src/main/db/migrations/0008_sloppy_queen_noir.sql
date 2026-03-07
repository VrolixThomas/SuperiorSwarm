CREATE TABLE `github_pr_file_viewed` (
	`id` text PRIMARY KEY NOT NULL,
	`pr_owner` text NOT NULL,
	`pr_repo` text NOT NULL,
	`pr_number` integer NOT NULL,
	`file_path` text NOT NULL,
	`viewed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_pr_file_viewed_unique` ON `github_pr_file_viewed` (`pr_owner`,`pr_repo`,`pr_number`,`file_path`);