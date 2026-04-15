CREATE TABLE `lsp_trusted_repos` (
	`repo_path` text PRIMARY KEY NOT NULL,
	`trusted` integer DEFAULT false NOT NULL,
	`decided_at` integer NOT NULL
);
