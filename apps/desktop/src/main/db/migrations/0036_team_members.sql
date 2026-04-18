CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`avatar_url` text,
	`team_id` text NOT NULL,
	`updated_at` integer NOT NULL
);
