CREATE TABLE `global_mcp_install` (
	`cli_preset` text PRIMARY KEY NOT NULL,
	`config_path` text NOT NULL,
	`installed_at` integer NOT NULL
);
