CREATE TABLE `atlassian_auth` (
	`service` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`cloud_id` text,
	`account_id` text NOT NULL,
	`display_name` text
);
