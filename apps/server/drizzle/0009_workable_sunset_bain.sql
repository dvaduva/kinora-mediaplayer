ALTER TABLE `albums` ADD `overview` text;--> statement-breakpoint
ALTER TABLE `albums` ADD `genres_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `albums` ADD `styles_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `albums` ADD `record_label` text;--> statement-breakpoint
ALTER TABLE `albums` ADD `rating` real;--> statement-breakpoint
ALTER TABLE `albums` ADD `meta_fetched_at` integer;