CREATE TABLE `activity_queue_sources` (
  `source_id` text PRIMARY KEY NOT NULL,
  `source_type` text NOT NULL,
  `snapshot` text NOT NULL,
  `fingerprint` text NOT NULL,
  `candidate` text,
  `revision` integer NOT NULL,
  `acknowledged_revision` integer,
  `observed_at` integer NOT NULL,
  `error` text
);
