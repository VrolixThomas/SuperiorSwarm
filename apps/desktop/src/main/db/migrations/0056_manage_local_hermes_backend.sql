ALTER TABLE `hermes_connections` ADD `management_mode` text DEFAULT 'external' NOT NULL;--> statement-breakpoint
-- Before managed startup existed, the ordinary Local Hermes surface persisted a
-- fixed loopback URL (normally :8080) plus a token discovered at that address.
-- Preserve the row ID and all dependent workspace/origin/report associations,
-- but replace transient transport state with the stable managed-local identity.
UPDATE `hermes_connections`
SET
	`base_url` = 'hermes-local://managed',
	`management_mode` = 'managed',
	`encrypted_token` = NULL,
	`token_storage` = 'memory'
WHERE
	lower(`base_url`) = 'http://127.0.0.1'
	OR lower(`base_url`) LIKE 'http://127.0.0.1:%'
	OR lower(`base_url`) LIKE 'http://127.0.0.1/%'
	OR lower(`base_url`) = 'https://127.0.0.1'
	OR lower(`base_url`) LIKE 'https://127.0.0.1:%'
	OR lower(`base_url`) LIKE 'https://127.0.0.1/%'
	OR lower(`base_url`) = 'ws://127.0.0.1'
	OR lower(`base_url`) LIKE 'ws://127.0.0.1:%'
	OR lower(`base_url`) LIKE 'ws://127.0.0.1/%'
	OR lower(`base_url`) = 'wss://127.0.0.1'
	OR lower(`base_url`) LIKE 'wss://127.0.0.1:%'
	OR lower(`base_url`) LIKE 'wss://127.0.0.1/%'
	OR lower(`base_url`) = 'http://localhost'
	OR lower(`base_url`) LIKE 'http://localhost:%'
	OR lower(`base_url`) LIKE 'http://localhost/%'
	OR lower(`base_url`) = 'https://localhost'
	OR lower(`base_url`) LIKE 'https://localhost:%'
	OR lower(`base_url`) LIKE 'https://localhost/%'
	OR lower(`base_url`) = 'ws://localhost'
	OR lower(`base_url`) LIKE 'ws://localhost:%'
	OR lower(`base_url`) LIKE 'ws://localhost/%'
	OR lower(`base_url`) = 'wss://localhost'
	OR lower(`base_url`) LIKE 'wss://localhost:%'
	OR lower(`base_url`) LIKE 'wss://localhost/%'
	OR lower(`base_url`) = 'http://[::1]'
	OR lower(`base_url`) LIKE 'http://[::1]:%'
	OR lower(`base_url`) LIKE 'http://[::1]/%'
	OR lower(`base_url`) = 'https://[::1]'
	OR lower(`base_url`) LIKE 'https://[::1]:%'
	OR lower(`base_url`) LIKE 'https://[::1]/%'
	OR lower(`base_url`) = 'ws://[::1]'
	OR lower(`base_url`) LIKE 'ws://[::1]:%'
	OR lower(`base_url`) LIKE 'ws://[::1]/%'
	OR lower(`base_url`) = 'wss://[::1]'
	OR lower(`base_url`) LIKE 'wss://[::1]:%'
	OR lower(`base_url`) LIKE 'wss://[::1]/%';
