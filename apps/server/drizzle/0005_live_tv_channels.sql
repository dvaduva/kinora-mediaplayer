CREATE TABLE `channel_programs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`seq` integer NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text,
	`file_id` text,
	`title` text NOT NULL,
	`subtitle` text,
	`description` text,
	`image` text,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channel_programs_channel_start` ON `channel_programs` (`channel_id`,`start`);--> statement-breakpoint
CREATE TABLE `channel_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channel_sources_channel` ON `channel_sources` (`channel_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`logo_path` text,
	`order_mode` text NOT NULL,
	`seed` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`category_override` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
