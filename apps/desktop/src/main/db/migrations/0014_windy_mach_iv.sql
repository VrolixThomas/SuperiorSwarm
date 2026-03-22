ALTER TABLE `ai_review_settings` ADD `auto_approve_resolutions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_review_settings` ADD `auto_publish_resolutions` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `draft_comments` ADD `previous_comment_id` text;--> statement-breakpoint
ALTER TABLE `draft_comments` ADD `resolution` text;--> statement-breakpoint
ALTER TABLE `draft_comments` ADD `resolution_reason` text;--> statement-breakpoint
ALTER TABLE `draft_comments` ADD `platform_comment_id` text;--> statement-breakpoint
ALTER TABLE `review_drafts` ADD `review_chain_id` text;--> statement-breakpoint
ALTER TABLE `review_drafts` ADD `round_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `review_drafts` ADD `previous_draft_id` text;