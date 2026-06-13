PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_workspace_id` text,
	`to_workspace_id` text,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`in_reply_to` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent_messages`("id", "project_id", "from_workspace_id", "to_workspace_id", "kind", "content", "in_reply_to", "created_at") SELECT "id", "project_id", "from_workspace_id", "to_workspace_id", "kind", "content", "in_reply_to", "created_at" FROM `agent_messages`;--> statement-breakpoint
DROP TABLE `agent_messages`;--> statement-breakpoint
ALTER TABLE `__new_agent_messages` RENAME TO `agent_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_messages_to_idx` ON `agent_messages` (`to_workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_messages_project_idx` ON `agent_messages` (`project_id`,`created_at`);