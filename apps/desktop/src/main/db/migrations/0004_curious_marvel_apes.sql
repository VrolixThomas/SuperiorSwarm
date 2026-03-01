CREATE TABLE `shared_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
