CREATE TABLE `memory_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`rationale` text NOT NULL,
	`alternatives` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_decisions_project_idx` ON `memory_decisions` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `memory_followups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`goal_id` text,
	`title` text NOT NULL,
	`body` text,
	`owner` text,
	`due_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`goal_id`) REFERENCES `memory_goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memory_followups_project_status_idx` ON `memory_followups` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `memory_followups_project_due_idx` ON `memory_followups` (`project_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `memory_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_goals_project_status_idx` ON `memory_goals` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `memory_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`file_path` text NOT NULL,
	`summary` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_journal_project_idx` ON `memory_journal` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `memory_open_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`question` text NOT NULL,
	`context` text,
	`status` text DEFAULT 'open' NOT NULL,
	`answer` text,
	`created_at` integer NOT NULL,
	`answered_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_questions_project_status_idx` ON `memory_open_questions` (`project_id`,`status`);
--> statement-breakpoint
CREATE VIRTUAL TABLE memory_fts USING fts5(
	kind,
	ref_id,
	project_id UNINDEXED,
	body,
	tokenize = 'porter unicode61'
);