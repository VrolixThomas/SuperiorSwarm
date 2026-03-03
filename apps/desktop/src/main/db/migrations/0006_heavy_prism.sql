CREATE TABLE `linear_auth` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`account_id` text NOT NULL,
	`display_name` text
);
--> statement-breakpoint
CREATE TABLE `linear_branch_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`linear_issue_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `linear_branch_issues_workspace_issue_unique` ON `linear_branch_issues` (`workspace_id`,`linear_issue_id`);