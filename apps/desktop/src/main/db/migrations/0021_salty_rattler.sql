CREATE TABLE `comment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`pr_provider` text NOT NULL,
	`pr_identifier` text NOT NULL,
	`workspace_id` text NOT NULL,
	`comment_count` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
