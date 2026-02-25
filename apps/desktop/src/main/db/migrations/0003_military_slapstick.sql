CREATE TABLE `diff_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`context_json` text NOT NULL,
	`repo_path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `extension_paths` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`installed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extension_paths_path_unique` ON `extension_paths` (`path`);