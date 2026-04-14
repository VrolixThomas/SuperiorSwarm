CREATE TABLE `telemetry_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`first_launch_at` integer NOT NULL,
	`first_signed_in_at` integer,
	`last_synced_at` integer,
	`consent_acknowledged_at` integer,
	`opt_out` integer DEFAULT false NOT NULL,
	`lifetime_sessions_started` integer DEFAULT 0 NOT NULL,
	`lifetime_reviews_started` integer DEFAULT 0 NOT NULL,
	`lifetime_comments_solved` integer DEFAULT 0 NOT NULL
);
