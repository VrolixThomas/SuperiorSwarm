CREATE TABLE `custom_mcp_install` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`config_path` text NOT NULL,
	`format` text NOT NULL,
	`installed_at` integer NOT NULL
);
