CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`group_key` text NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`cover_path` text,
	`mbid` text,
	`matched` integer DEFAULT false NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artists` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`mbid` text
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`title` text NOT NULL,
	`overview` text,
	`still_path` text,
	`runtime` integer,
	`air_date` text
);
--> statement-breakpoint
CREATE TABLE `libraries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`roots` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_files` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`movie_id` text,
	`episode_id` text,
	`track_id` text,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`mtime` integer NOT NULL,
	`container` text,
	`duration` real,
	`video_codec` text,
	`width` integer,
	`height` integer,
	`audio_json` text DEFAULT '[]' NOT NULL,
	`missing` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_files_library` ON `media_files` (`library_id`);--> statement-breakpoint
CREATE INDEX `media_files_movie` ON `media_files` (`movie_id`);--> statement-breakpoint
CREATE INDEX `media_files_episode` ON `media_files` (`episode_id`);--> statement-breakpoint
CREATE INDEX `media_files_track` ON `media_files` (`track_id`);--> statement-breakpoint
CREATE TABLE `movies` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`group_key` text NOT NULL,
	`tmdb_id` integer,
	`imdb_id` text,
	`title` text NOT NULL,
	`original_title` text,
	`year` integer,
	`overview` text,
	`tagline` text,
	`runtime` integer,
	`release_date` text,
	`poster_path` text,
	`backdrop_path` text,
	`rating` real,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`directors_json` text DEFAULT '[]' NOT NULL,
	`writers_json` text DEFAULT '[]' NOT NULL,
	`cast_json` text DEFAULT '[]' NOT NULL,
	`stills_json` text DEFAULT '[]' NOT NULL,
	`similar_json` text DEFAULT '[]' NOT NULL,
	`trailer_json` text,
	`matched` integer DEFAULT false NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subtitle_language` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `progress` (
	`profile_id` text NOT NULL,
	`file_id` text NOT NULL,
	`position` real NOT NULL,
	`duration` real NOT NULL,
	`watched` integer NOT NULL,
	`subtitle_choice` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `file_id`)
);
--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`name` text,
	`overview` text,
	`poster_path` text
);
--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`group_key` text NOT NULL,
	`tmdb_id` integer,
	`imdb_id` text,
	`title` text NOT NULL,
	`original_title` text,
	`year` integer,
	`overview` text,
	`poster_path` text,
	`backdrop_path` text,
	`rating` real,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`creators_json` text DEFAULT '[]' NOT NULL,
	`cast_json` text DEFAULT '[]' NOT NULL,
	`similar_json` text DEFAULT '[]' NOT NULL,
	`trailer_json` text,
	`matched` integer DEFAULT false NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtitle_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`origin` text NOT NULL,
	`path` text,
	`stream_index` integer,
	`codec` text,
	`language` text,
	`forced` integer DEFAULT false NOT NULL,
	`hearing_impaired` integer DEFAULT false NOT NULL,
	`is_default` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`title` text NOT NULL,
	`track_number` integer,
	`disc_number` integer,
	`artist_name` text,
	`duration` real
);
