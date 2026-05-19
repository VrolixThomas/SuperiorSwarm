CREATE TABLE `cross_repo_orchestrator_projects` (
	`orchestrator_id` text NOT NULL,
	`project_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`orchestrator_id`, `project_id`),
	FOREIGN KEY (`orchestrator_id`) REFERENCES `cross_repo_orchestrators`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `xro_projects_proj_idx` ON `cross_repo_orchestrator_projects` (`project_id`);--> statement-breakpoint
CREATE TABLE `cross_repo_orchestrators` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`work_dir` text NOT NULL,
	`agent_kind` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`color_index` integer,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_orchestrator_members` (
	`orchestrator_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_kind` text DEFAULT 'workspace' NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`orchestrator_id`, `workspace_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_orchestrator_members`("orchestrator_id", "workspace_id", "parent_kind", "sort_order", "created_at") SELECT "orchestrator_id", "workspace_id", "parent_kind", "sort_order", "created_at" FROM `orchestrator_members`;--> statement-breakpoint
DROP TABLE `orchestrator_members`;--> statement-breakpoint
ALTER TABLE `__new_orchestrator_members` RENAME TO `orchestrator_members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `orch_members_workspace_idx` ON `orchestrator_members` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `orch_members_orch_sort_idx` ON `orchestrator_members` (`orchestrator_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `orch_members_parent_kind_idx` ON `orchestrator_members` (`parent_kind`,`orchestrator_id`);