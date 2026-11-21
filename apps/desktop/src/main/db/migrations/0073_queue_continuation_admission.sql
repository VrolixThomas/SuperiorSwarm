ALTER TABLE `activity_queue_deliveries` ADD `mode` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `activity_queue_deliveries` ADD `answer_binding` text;