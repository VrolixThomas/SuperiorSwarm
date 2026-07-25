CREATE TABLE `agent_sessions` (
	`terminal_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_session_id` text,
	`state` text DEFAULT 'running' NOT NULL,
	`managed` integer DEFAULT false NOT NULL,
	`keep_running` integer DEFAULT false NOT NULL,
	`skip_permissions` integer DEFAULT false NOT NULL,
	`last_event_at` integer,
	`idle_since` integer,
	`hibernated_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_workspace_idx` ON `agent_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_provider_session_idx` ON `agent_sessions` (`provider`,`provider_session_id`);