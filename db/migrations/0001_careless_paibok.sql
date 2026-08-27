CREATE TABLE `published_feed_calendars` (
	`feed_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `published_feeds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `published_feed_calendars_idx` ON `published_feed_calendars` (`feed_id`,`calendar_id`);--> statement-breakpoint
CREATE INDEX `published_feed_calendars_feed_idx` ON `published_feed_calendars` (`feed_id`);--> statement-breakpoint
CREATE TABLE `published_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_public` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `published_feeds_slug_idx` ON `published_feeds` (`slug`);--> statement-breakpoint
ALTER TABLE `calendars` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `calendars` ADD `source_etag` text;--> statement-breakpoint
ALTER TABLE `calendars` ADD `source_last_modified` text;--> statement-breakpoint
ALTER TABLE `calendars` ADD `last_synced_at` integer;--> statement-breakpoint
ALTER TABLE `calendars` ADD `last_sync_status` text;--> statement-breakpoint
ALTER TABLE `calendars` ADD `last_sync_error` text;--> statement-breakpoint
ALTER TABLE `calendars` ADD `last_sync_count` integer;--> statement-breakpoint
ALTER TABLE `calendars` ADD `last_sync_skipped` integer;--> statement-breakpoint
ALTER TABLE `events` ADD `source_uid` text;--> statement-breakpoint
ALTER TABLE `events` ADD `content_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `events_source_uid_idx` ON `events` (`calendar_id`,`source_uid`);