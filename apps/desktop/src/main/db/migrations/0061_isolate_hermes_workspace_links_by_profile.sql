DROP INDEX `hermes_session_workspaces_unique`;--> statement-breakpoint
DROP INDEX `hermes_session_workspaces_session_idx`;--> statement-breakpoint
ALTER TABLE `hermes_session_workspaces` ADD `profile_id` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
UPDATE `hermes_session_workspaces`
SET `profile_id` = COALESCE(
	(SELECT `profile_id` FROM `hermes_connections`
	 WHERE `hermes_connections`.`id` = `hermes_session_workspaces`.`connection_id`),
	'default'
);--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_session_workspaces_unique` ON `hermes_session_workspaces` (`connection_id`,`profile_id`,`hermes_session_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `hermes_session_workspaces_session_idx` ON `hermes_session_workspaces` (`connection_id`,`profile_id`,`hermes_session_id`);
