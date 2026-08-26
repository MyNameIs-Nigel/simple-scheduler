CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`accent` integer DEFAULT 1 NOT NULL,
	`is_public` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendars_slug_idx` ON `calendars` (`slug`);--> statement-breakpoint
CREATE TABLE `event_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`recurrence_id` integer NOT NULL,
	`summary` text,
	`description` text,
	`location` text,
	`dtstart` integer,
	`dtend` integer,
	`cancelled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_overrides_event_recurrence_idx` ON `event_overrides` (`event_id`,`recurrence_id`);--> statement-breakpoint
CREATE INDEX `event_overrides_event_idx` ON `event_overrides` (`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`uid` text NOT NULL,
	`summary` text NOT NULL,
	`description` text,
	`location` text,
	`url` text,
	`dtstart` integer NOT NULL,
	`dtend` integer NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`rrule` text,
	`exdates` text,
	`status` text DEFAULT 'CONFIRMED' NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_uid_idx` ON `events` (`uid`);--> statement-breakpoint
CREATE INDEX `events_calendar_idx` ON `events` (`calendar_id`);--> statement-breakpoint
CREATE INDEX `events_dtstart_idx` ON `events` (`dtstart`);