ALTER TABLE `cross_repo_orchestrators` ADD `kind` text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `cross_repo_orchestrators` ADD `token_hash` text;--> statement-breakpoint
ALTER TABLE `cross_repo_orchestrators` ADD `dispatch_policy` text DEFAULT 'confirm' NOT NULL;--> statement-breakpoint
ALTER TABLE `cross_repo_orchestrators` ADD `last_seen_at` integer;