ALTER TABLE `channels` ADD `align_minutes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `channels` ADD `filler` text DEFAULT 'media' NOT NULL;