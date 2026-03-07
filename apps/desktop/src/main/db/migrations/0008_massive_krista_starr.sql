CREATE TABLE `github_auth` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`account_id` text NOT NULL,
	`display_name` text
);
--> statement-breakpoint
CREATE TABLE `github_branch_prs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`pr_repo_owner` text NOT NULL,
	`pr_repo_name` text NOT NULL,
	`pr_number` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_branch_prs_workspace_pr_unique` ON `github_branch_prs` (`workspace_id`,`pr_repo_owner`,`pr_repo_name`,`pr_number`);--> statement-breakpoint
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