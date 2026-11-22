-- Reconcile additive tables skipped by either branch's higher migration watermark.
CREATE TABLE IF NOT EXISTS `review_path_documents` (
	`key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_path_preferences` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `activity_queue_sources` (
  `source_id` text PRIMARY KEY NOT NULL,
  `source_type` text NOT NULL,
  `snapshot` text NOT NULL,
  `fingerprint` text NOT NULL,
  `candidate` text,
  `revision` integer NOT NULL,
  `acknowledged_revision` integer,
  `observed_at` integer NOT NULL,
  `error` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `activity_queue_snoozes` (
	`source_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`until` integer,
	`until_change` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `activity_queue_sources`(`source_id`) ON UPDATE no action ON DELETE cascade
);
