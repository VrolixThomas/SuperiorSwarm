CREATE TABLE `ticket_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`data` text NOT NULL,
	`group_id` text NOT NULL,
	`updated_at` integer NOT NULL
);
