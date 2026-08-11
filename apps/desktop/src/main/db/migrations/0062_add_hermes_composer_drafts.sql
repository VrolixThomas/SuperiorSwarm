CREATE TABLE `hermes_composer_drafts` (
	`manager_id` text NOT NULL,
	`project_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`durable_session_id` text NOT NULL,
	`text` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`manager_id`, `project_id`, `connection_id`, `profile_id`, `durable_session_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `hermes_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hermes_composer_drafts_connection_idx` ON `hermes_composer_drafts` (`connection_id`);