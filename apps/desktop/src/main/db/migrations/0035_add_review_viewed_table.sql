CREATE TABLE `review_viewed` (
	`workspace_id` text NOT NULL,
	`file_path` text NOT NULL,
	`content_hash` text NOT NULL,
	`viewed_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `file_path`)
);
--> statement-breakpoint
CREATE INDEX `idx_review_viewed_workspace` ON `review_viewed` (`workspace_id`);