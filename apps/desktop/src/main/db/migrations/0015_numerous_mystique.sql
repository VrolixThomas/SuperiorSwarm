ALTER TABLE `workspaces` ADD `pr_provider` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `pr_identifier` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `review_draft_id` text REFERENCES review_drafts(id);--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_pr_unique` ON `workspaces` (`project_id`,`pr_provider`,`pr_identifier`);--> statement-breakpoint
INSERT INTO `workspaces` (`id`, `project_id`, `type`, `name`, `worktree_id`, `terminal_id`, `pr_provider`, `pr_identifier`, `review_draft_id`, `created_at`, `updated_at`)
SELECT `id`, `project_id`, 'review', `pr_identifier`, `worktree_id`, `terminal_id`, `pr_provider`, `pr_identifier`, `review_draft_id`, `created_at`, `updated_at`
FROM `review_workspaces`;--> statement-breakpoint
DROP TABLE `review_workspaces`;