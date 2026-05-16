CREATE TABLE `orchestrator_members` (
	`orchestrator_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`orchestrator_id`, `workspace_id`),
	FOREIGN KEY (`orchestrator_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `orch_members_workspace_idx` ON `orchestrator_members` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `orch_members_orch_sort_idx` ON `orchestrator_members` (`orchestrator_id`,`sort_order`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE workspaces
SET sort_order = (
	SELECT COUNT(*) - 1
	FROM workspaces AS w2
	WHERE w2.project_id = workspaces.project_id
	  AND w2.created_at <= workspaces.created_at
);