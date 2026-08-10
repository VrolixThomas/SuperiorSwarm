ALTER TABLE `hermes_connections` ADD `management_mode` text DEFAULT 'external' NOT NULL;--> statement-breakpoint
-- Before managed startup existed, the untouched ordinary Local Hermes form used
-- this exact label, profile, and URL. Scope conversion to that deterministic
-- legacy identity; advanced loopback rows remain external. Keep transport fields
-- intact so a previous binary can still recover the legacy connection.
UPDATE `hermes_connections`
SET
	`management_mode` = 'managed'
WHERE
	`label` = 'Local Hermes'
	AND `profile_id` = 'default'
	AND `base_url` = 'http://127.0.0.1:8080';
