CREATE TABLE `movie_reviews` (
	`profile_id` text NOT NULL,
	`movie_id` text NOT NULL,
	`rating` real,
	`body` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `movie_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `movies` ADD `sort_title` text;--> statement-breakpoint
ALTER TABLE `movies` ADD `edition` text;--> statement-breakpoint
ALTER TABLE `movies` ADD `locked_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `movies` ADD `rt_slug` text;--> statement-breakpoint
ALTER TABLE `movies` ADD `external_ratings_json` text;--> statement-breakpoint
ALTER TABLE `movies` ADD `external_ratings_at` integer;