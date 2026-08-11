CREATE TABLE IF NOT EXISTS `hermes_session_metadata` (
	`manager_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`durable_session_id` text NOT NULL,
	`custom_title` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`manager_id`, `connection_id`, `profile_id`, `durable_session_id`),
	FOREIGN KEY (`manager_id`) REFERENCES `cross_repo_orchestrators`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `hermes_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `hermes_session_metadata_connection_idx` ON `hermes_session_metadata` (`connection_id`,`profile_id`,`durable_session_id`);
