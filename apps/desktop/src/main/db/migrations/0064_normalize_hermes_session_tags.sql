CREATE TABLE `hermes_session_tag_assignments` (
	`manager_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`durable_session_id` text NOT NULL,
	`definition_id` text NOT NULL,
	`position` integer NOT NULL,
	`assigned_at` integer NOT NULL,
	PRIMARY KEY(`manager_id`, `connection_id`, `profile_id`, `durable_session_id`, `definition_id`),
	FOREIGN KEY (`definition_id`,`manager_id`,`connection_id`,`profile_id`) REFERENCES `hermes_tag_definitions`(`id`,`manager_id`,`connection_id`,`profile_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hermes_session_tag_assignments_session_idx` ON `hermes_session_tag_assignments` (`manager_id`,`connection_id`,`profile_id`,`durable_session_id`,`position`);--> statement-breakpoint
CREATE TABLE `hermes_tag_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`manager_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_key` text NOT NULL,
	`color` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`manager_id`) REFERENCES `cross_repo_orchestrators`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `hermes_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "hermes_tag_definitions_color_check" CHECK("hermes_tag_definitions"."color" in ('gray', 'blue', 'cyan', 'green', 'amber', 'orange', 'red', 'pink', 'purple'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_tag_definitions_scope_key_unique` ON `hermes_tag_definitions` (`manager_id`,`connection_id`,`profile_id`,`normalized_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_tag_definitions_scope_id_unique` ON `hermes_tag_definitions` (`id`,`manager_id`,`connection_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `hermes_tag_definitions_scope_name_idx` ON `hermes_tag_definitions` (`manager_id`,`connection_id`,`profile_id`,`name`);