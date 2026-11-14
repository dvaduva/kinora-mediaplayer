CREATE TABLE `movie_list_items` (
	`list_id` text NOT NULL,
	`movie_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`list_id`, `movie_id`),
	FOREIGN KEY (`list_id`) REFERENCES `movie_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `movie_list_items_movie` ON `movie_list_items` (`movie_id`);--> statement-breakpoint
CREATE TABLE `movie_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `movie_lists_profile` ON `movie_lists` (`profile_id`);