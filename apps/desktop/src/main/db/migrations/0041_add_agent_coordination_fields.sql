CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_workspace_id` text NOT NULL,
	`to_workspace_id` text,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`in_reply_to` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_messages_to_idx` ON `agent_messages` (`to_workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_messages_project_idx` ON `agent_messages` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `current_phase` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `status_text` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `needs` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `status_updated_at` integer;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `cli_session_id` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `cli_preset` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `is_orchestrator` integer DEFAULT false NOT NULL;