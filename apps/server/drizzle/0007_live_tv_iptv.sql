CREATE TABLE `iptv_epg_channels` (
	`source_id` text NOT NULL,
	`epg_id` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`source_id`, `epg_id`),
	FOREIGN KEY (`source_id`) REFERENCES `iptv_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `iptv_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`m3u_url` text NOT NULL,
	`xmltv_url` text,
	`playlist_epg_url` text,
	`refreshed_at` integer,
	`status` text NOT NULL,
	`error` text,
	`epg_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `channels` ADD `iptv_source_id` text REFERENCES iptv_sources(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `channels` ADD `iptv_key` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `stream_url` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `tvg_id` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `m3u_name` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `remote_logo` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `group_title` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `epg_channel` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `epg_match` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `iptv_missing` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `channels_iptv_source` ON `channels` (`iptv_source_id`);