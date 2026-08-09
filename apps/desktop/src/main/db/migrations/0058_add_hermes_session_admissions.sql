CREATE TABLE `hermes_session_admissions` (
	`manager_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`durable_session_id` text NOT NULL,
	`admission_reason` text NOT NULL,
	`source_platform` text NOT NULL,
	`is_cron` integer DEFAULT false NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`manager_id`, `profile_id`, `durable_session_id`),
	FOREIGN KEY (`manager_id`) REFERENCES `cross_repo_orchestrators`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hermes_session_admissions_manager_profile_idx` ON `hermes_session_admissions` (`manager_id`,`profile_id`,`last_seen_at`);