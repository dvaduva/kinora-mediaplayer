ALTER TABLE `profiles` ADD `subtitle_size` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `subtitle_color` text DEFAULT '#ffffff' NOT NULL;--> statement-breakpoint
ALTER TABLE `progress` ADD `subtitle_delay` real DEFAULT 0 NOT NULL;