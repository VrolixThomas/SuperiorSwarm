CREATE TABLE `hermes_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`base_url` text NOT NULL,
	`profile_id` text NOT NULL,
	`encrypted_token` text,
	`token_storage` text DEFAULT 'memory' NOT NULL,
	`last_connected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hermes_origin_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`hermes_session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retryable` integer DEFAULT false NOT NULL,
	`message_id` text,
	`permalink` text,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `hermes_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_origin_reports_unique` ON `hermes_origin_reports` (`connection_id`,`hermes_session_id`,`turn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_origin_reports_idempotency_unique` ON `hermes_origin_reports` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `hermes_session_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`hermes_session_id` text NOT NULL,
	`hermes_lineage_root_id` text,
	`workspace_id` text NOT NULL,
	`source` text NOT NULL,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `hermes_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_session_workspaces_unique` ON `hermes_session_workspaces` (`connection_id`,`hermes_session_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `hermes_session_workspaces_session_idx` ON `hermes_session_workspaces` (`connection_id`,`hermes_session_id`);--> statement-breakpoint
CREATE INDEX `hermes_session_workspaces_workspace_idx` ON `hermes_session_workspaces` (`workspace_id`);