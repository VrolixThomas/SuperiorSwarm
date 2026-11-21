CREATE TABLE `activity_queue_snoozes` (
	`source_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`until` integer,
	`until_change` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `activity_queue_sources`(`source_id`) ON UPDATE no action ON DELETE cascade
);
