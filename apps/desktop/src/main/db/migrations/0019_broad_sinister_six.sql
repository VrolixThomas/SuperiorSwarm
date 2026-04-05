CREATE TABLE `quick_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`label` text NOT NULL,
	`command` text NOT NULL,
	`cwd` text,
	`shortcut` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
