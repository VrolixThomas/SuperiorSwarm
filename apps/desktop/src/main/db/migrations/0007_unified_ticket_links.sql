CREATE TABLE `ticket_branch_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL CHECK (provider IN ('linear', 'jira')),
	`ticket_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_branch_links_workspace_provider_ticket_unique` ON `ticket_branch_links` (`workspace_id`,`provider`,`ticket_id`);
--> statement-breakpoint
INSERT INTO `ticket_branch_links` (id, workspace_id, provider, ticket_id, created_at)
SELECT id, workspace_id, 'linear', linear_issue_id, created_at FROM `linear_branch_issues`;
--> statement-breakpoint
DROP TABLE `linear_branch_issues`;
