CREATE TABLE `review_path_documents` (
	`key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `review_path_preferences` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
