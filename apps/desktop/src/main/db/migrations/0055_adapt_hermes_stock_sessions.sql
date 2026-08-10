CREATE TABLE `hermes_origin_links` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`hermes_session_id` text NOT NULL,
	`platform` text NOT NULL,
	`open_url` text NOT NULL,
	`origin_fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `hermes_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_origin_links_unique` ON `hermes_origin_links` (`connection_id`,`profile_id`,`hermes_session_id`);--> statement-breakpoint
-- Fork-era report receipts cannot be safely mapped because they identify a custom
-- report operation rather than a stock Hermes message and canonical destination.
-- They are best-effort local state, so replace them instead of inventing delivery history.
DROP TABLE `hermes_origin_reports`;--> statement-breakpoint
CREATE TABLE `hermes_origin_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`hermes_session_id` text NOT NULL,
	`message_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`destination_fingerprint` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retryable` integer DEFAULT false NOT NULL,
	`provider_message_id` text,
	`error_code` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `hermes_connections`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_origin_reports_unique` ON `hermes_origin_reports` (`connection_id`,`profile_id`,`hermes_session_id`,`message_key`,`destination_fingerprint`);
