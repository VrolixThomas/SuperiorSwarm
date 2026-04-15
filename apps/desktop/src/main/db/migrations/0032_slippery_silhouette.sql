CREATE TABLE `telemetry_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`first_launch_at` integer NOT NULL,
	`first_signed_in_at` integer,
	`last_synced_at` integer,
	`opt_out` integer DEFAULT false NOT NULL,
	`lifetime_sessions_started` integer DEFAULT 0 NOT NULL,
	`lifetime_reviews_started` integer DEFAULT 0 NOT NULL,
	`lifetime_comments_solved` integer DEFAULT 0 NOT NULL,
	`ever_connected_github` integer DEFAULT false NOT NULL,
	`ever_connected_linear` integer DEFAULT false NOT NULL,
	`ever_connected_jira` integer DEFAULT false NOT NULL,
	`ever_connected_bitbucket` integer DEFAULT false NOT NULL
);
