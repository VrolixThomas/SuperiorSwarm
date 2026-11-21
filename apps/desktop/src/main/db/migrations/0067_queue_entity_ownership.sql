PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_workspace_id` text,
	`to_workspace_id` text,
	`reporter` text,
	`recipient` text,
	`retrieved_at` integer,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`in_reply_to` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_messages`("id", "project_id", "from_workspace_id", "to_workspace_id", "reporter", "recipient", "retrieved_at", "kind", "content", "in_reply_to", "created_at") SELECT "id", "project_id", "from_workspace_id", "to_workspace_id", NULL, NULL, NULL, "kind", "content", "in_reply_to", "created_at" FROM `agent_messages`;--> statement-breakpoint
DROP TABLE `agent_messages`;--> statement-breakpoint
ALTER TABLE `__new_agent_messages` RENAME TO `agent_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_messages_to_idx` ON `agent_messages` (`to_workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_messages_project_idx` ON `agent_messages` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_agent_sessions` (
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
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_agent_sessions`("terminal_id", "workspace_id", "provider", "provider_session_id", "state", "managed", "keep_running", "skip_permissions", "last_event_at", "idle_since", "hibernated_at", "last_error", "created_at", "updated_at") SELECT "terminal_id", "workspace_id", "provider", "provider_session_id", "state", "managed", "keep_running", "skip_permissions", "last_event_at", "idle_since", "hibernated_at", "last_error", "created_at", "updated_at" FROM `agent_sessions`;--> statement-breakpoint
DROP TABLE `agent_sessions`;--> statement-breakpoint
ALTER TABLE `__new_agent_sessions` RENAME TO `agent_sessions`;--> statement-breakpoint
CREATE INDEX `agent_sessions_workspace_idx` ON `agent_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_provider_session_idx` ON `agent_sessions` (`provider`,`provider_session_id`);--> statement-breakpoint
ALTER TABLE `cross_repo_orchestrators` ADD `status_text` text;--> statement-breakpoint
ALTER TABLE `cross_repo_orchestrators` ADD `needs` text;--> statement-breakpoint
ALTER TABLE `cross_repo_orchestrators` ADD `status_updated_at` integer;
--> statement-breakpoint
CREATE TRIGGER agent_sessions_entity_insert BEFORE INSERT ON agent_sessions
WHEN (SELECT count(*) FROM workspaces WHERE id = NEW.workspace_id) + (SELECT count(*) FROM cross_repo_orchestrators WHERE id = NEW.workspace_id AND kind = 'workspace') != 1
BEGIN SELECT RAISE(ABORT, 'unknown agent entity'); END;
--> statement-breakpoint
CREATE TRIGGER agent_sessions_entity_update BEFORE UPDATE OF workspace_id ON agent_sessions
WHEN (SELECT count(*) FROM workspaces WHERE id = NEW.workspace_id) + (SELECT count(*) FROM cross_repo_orchestrators WHERE id = NEW.workspace_id AND kind = 'workspace') != 1
BEGIN SELECT RAISE(ABORT, 'unknown agent entity'); END;
--> statement-breakpoint
CREATE TRIGGER agent_sessions_workspace_delete AFTER DELETE ON workspaces
BEGIN DELETE FROM agent_sessions WHERE workspace_id = OLD.id AND NOT EXISTS (SELECT 1 FROM cross_repo_orchestrators WHERE id = OLD.id); END;
--> statement-breakpoint
CREATE TRIGGER agent_sessions_coordinator_delete AFTER DELETE ON cross_repo_orchestrators
BEGIN DELETE FROM agent_sessions WHERE workspace_id = OLD.id AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.id); END;

--> statement-breakpoint
CREATE TRIGGER workspace_entity_collision BEFORE INSERT ON workspaces
WHEN EXISTS (SELECT 1 FROM cross_repo_orchestrators WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'ambiguous agent entity'); END;
--> statement-breakpoint
CREATE TRIGGER coordinator_entity_collision BEFORE INSERT ON cross_repo_orchestrators
WHEN EXISTS (SELECT 1 FROM workspaces WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'ambiguous agent entity'); END;
