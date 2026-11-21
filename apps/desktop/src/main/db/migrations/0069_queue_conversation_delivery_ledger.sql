CREATE TABLE `activity_queue_deliveries` (
	`request_id` text PRIMARY KEY NOT NULL,
	`occurrence_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`target` text NOT NULL,
	`members` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_queue_deliveries_occurrence_key_unique` ON `activity_queue_deliveries` (`occurrence_key`);