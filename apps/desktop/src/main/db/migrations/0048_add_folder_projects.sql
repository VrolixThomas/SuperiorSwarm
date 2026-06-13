ALTER TABLE `projects` ADD `kind` text DEFAULT 'repo' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `folder_path` text;
