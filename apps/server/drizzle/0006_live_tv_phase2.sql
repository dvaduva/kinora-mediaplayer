CREATE TABLE `profile_channels` (
	`profile_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`position` integer,
	PRIMARY KEY(`profile_id`, `channel_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `channels` ADD `auto_key` text;--> statement-breakpoint
ALTER TABLE `tracks` ADD `genre` text;