-- Remove rows that point at deleted parents so the rebuilt tables satisfy their new foreign keys.
DELETE FROM `movies` WHERE `library_id` NOT IN (SELECT `id` FROM `libraries`);--> statement-breakpoint
DELETE FROM `series` WHERE `library_id` NOT IN (SELECT `id` FROM `libraries`);--> statement-breakpoint
DELETE FROM `artists` WHERE `library_id` NOT IN (SELECT `id` FROM `libraries`);--> statement-breakpoint
DELETE FROM `albums` WHERE `library_id` NOT IN (SELECT `id` FROM `libraries`) OR `artist_id` NOT IN (SELECT `id` FROM `artists`);--> statement-breakpoint
DELETE FROM `tracks` WHERE `album_id` NOT IN (SELECT `id` FROM `albums`);--> statement-breakpoint
DELETE FROM `seasons` WHERE `series_id` NOT IN (SELECT `id` FROM `series`);--> statement-breakpoint
DELETE FROM `episodes` WHERE `series_id` NOT IN (SELECT `id` FROM `series`);--> statement-breakpoint
DELETE FROM `media_files` WHERE `library_id` NOT IN (SELECT `id` FROM `libraries`);--> statement-breakpoint
UPDATE `media_files` SET `movie_id` = NULL WHERE `movie_id` IS NOT NULL AND `movie_id` NOT IN (SELECT `id` FROM `movies`);--> statement-breakpoint
UPDATE `media_files` SET `episode_id` = NULL WHERE `episode_id` IS NOT NULL AND `episode_id` NOT IN (SELECT `id` FROM `episodes`);--> statement-breakpoint
UPDATE `media_files` SET `track_id` = NULL WHERE `track_id` IS NOT NULL AND `track_id` NOT IN (SELECT `id` FROM `tracks`);--> statement-breakpoint
DELETE FROM `subtitle_assets` WHERE `file_id` NOT IN (SELECT `id` FROM `media_files`);--> statement-breakpoint
DELETE FROM `progress` WHERE `file_id` NOT IN (SELECT `id` FROM `media_files`) OR `profile_id` NOT IN (SELECT `id` FROM `profiles`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_albums` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`group_key` text NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`cover_path` text,
	`mbid` text,
	`matched` integer DEFAULT false NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_albums`("id", "library_id", "artist_id", "group_key", "title", "year", "cover_path", "mbid", "matched", "added_at") SELECT "id", "library_id", "artist_id", "group_key", "title", "year", "cover_path", "mbid", "matched", "added_at" FROM `albums`;--> statement-breakpoint
DROP TABLE `albums`;--> statement-breakpoint
ALTER TABLE `__new_albums` RENAME TO `albums`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `albums_library` ON `albums` (`library_id`);--> statement-breakpoint
CREATE INDEX `albums_artist` ON `albums` (`artist_id`);--> statement-breakpoint
CREATE TABLE `__new_artists` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`mbid` text,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_artists`("id", "library_id", "name", "name_key", "mbid") SELECT "id", "library_id", "name", "name_key", "mbid" FROM `artists`;--> statement-breakpoint
DROP TABLE `artists`;--> statement-breakpoint
ALTER TABLE `__new_artists` RENAME TO `artists`;--> statement-breakpoint
CREATE INDEX `artists_library` ON `artists` (`library_id`);--> statement-breakpoint
CREATE TABLE `__new_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`title` text NOT NULL,
	`overview` text,
	`still_path` text,
	`runtime` integer,
	`air_date` text,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_episodes`("id", "series_id", "season_number", "episode_number", "title", "overview", "still_path", "runtime", "air_date") SELECT "id", "series_id", "season_number", "episode_number", "title", "overview", "still_path", "runtime", "air_date" FROM `episodes`;--> statement-breakpoint
DROP TABLE `episodes`;--> statement-breakpoint
ALTER TABLE `__new_episodes` RENAME TO `episodes`;--> statement-breakpoint
CREATE INDEX `episodes_series` ON `episodes` (`series_id`);--> statement-breakpoint
CREATE TABLE `__new_movies` (
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
	`added_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_movies`("id", "library_id", "group_key", "tmdb_id", "imdb_id", "title", "original_title", "year", "overview", "tagline", "runtime", "release_date", "poster_path", "backdrop_path", "rating", "genres_json", "directors_json", "writers_json", "cast_json", "stills_json", "similar_json", "trailer_json", "matched", "added_at") SELECT "id", "library_id", "group_key", "tmdb_id", "imdb_id", "title", "original_title", "year", "overview", "tagline", "runtime", "release_date", "poster_path", "backdrop_path", "rating", "genres_json", "directors_json", "writers_json", "cast_json", "stills_json", "similar_json", "trailer_json", "matched", "added_at" FROM `movies`;--> statement-breakpoint
DROP TABLE `movies`;--> statement-breakpoint
ALTER TABLE `__new_movies` RENAME TO `movies`;--> statement-breakpoint
CREATE INDEX `movies_library` ON `movies` (`library_id`);--> statement-breakpoint
CREATE TABLE `__new_progress` (
	`profile_id` text NOT NULL,
	`file_id` text NOT NULL,
	`position` real NOT NULL,
	`duration` real NOT NULL,
	`watched` integer NOT NULL,
	`subtitle_choice` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `file_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_progress`("profile_id", "file_id", "position", "duration", "watched", "subtitle_choice", "updated_at") SELECT "profile_id", "file_id", "position", "duration", "watched", "subtitle_choice", "updated_at" FROM `progress`;--> statement-breakpoint
DROP TABLE `progress`;--> statement-breakpoint
ALTER TABLE `__new_progress` RENAME TO `progress`;--> statement-breakpoint
CREATE INDEX `progress_file` ON `progress` (`file_id`);--> statement-breakpoint
CREATE TABLE `__new_seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`season_number` integer NOT NULL,
	`name` text,
	`overview` text,
	`poster_path` text,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_seasons`("id", "series_id", "season_number", "name", "overview", "poster_path") SELECT "id", "series_id", "season_number", "name", "overview", "poster_path" FROM `seasons`;--> statement-breakpoint
DROP TABLE `seasons`;--> statement-breakpoint
ALTER TABLE `__new_seasons` RENAME TO `seasons`;--> statement-breakpoint
CREATE INDEX `seasons_series` ON `seasons` (`series_id`);--> statement-breakpoint
CREATE TABLE `__new_series` (
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
	`added_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_series`("id", "library_id", "group_key", "tmdb_id", "imdb_id", "title", "original_title", "year", "overview", "poster_path", "backdrop_path", "rating", "genres_json", "creators_json", "cast_json", "similar_json", "trailer_json", "matched", "added_at") SELECT "id", "library_id", "group_key", "tmdb_id", "imdb_id", "title", "original_title", "year", "overview", "poster_path", "backdrop_path", "rating", "genres_json", "creators_json", "cast_json", "similar_json", "trailer_json", "matched", "added_at" FROM `series`;--> statement-breakpoint
DROP TABLE `series`;--> statement-breakpoint
ALTER TABLE `__new_series` RENAME TO `series`;--> statement-breakpoint
CREATE INDEX `series_library` ON `series` (`library_id`);--> statement-breakpoint
CREATE TABLE `__new_subtitle_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`origin` text NOT NULL,
	`path` text,
	`stream_index` integer,
	`codec` text,
	`language` text,
	`forced` integer DEFAULT false NOT NULL,
	`hearing_impaired` integer DEFAULT false NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_subtitle_assets`("id", "file_id", "origin", "path", "stream_index", "codec", "language", "forced", "hearing_impaired", "is_default") SELECT "id", "file_id", "origin", "path", "stream_index", "codec", "language", "forced", "hearing_impaired", "is_default" FROM `subtitle_assets`;--> statement-breakpoint
DROP TABLE `subtitle_assets`;--> statement-breakpoint
ALTER TABLE `__new_subtitle_assets` RENAME TO `subtitle_assets`;--> statement-breakpoint
CREATE INDEX `subtitle_assets_file` ON `subtitle_assets` (`file_id`);--> statement-breakpoint
CREATE TABLE `__new_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`title` text NOT NULL,
	`track_number` integer,
	`disc_number` integer,
	`artist_name` text,
	`duration` real,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tracks`("id", "album_id", "title", "track_number", "disc_number", "artist_name", "duration") SELECT "id", "album_id", "title", "track_number", "disc_number", "artist_name", "duration" FROM `tracks`;--> statement-breakpoint
DROP TABLE `tracks`;--> statement-breakpoint
ALTER TABLE `__new_tracks` RENAME TO `tracks`;--> statement-breakpoint
CREATE INDEX `tracks_album` ON `tracks` (`album_id`);--> statement-breakpoint
CREATE TABLE `__new_media_files` (
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
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_media_files`("id", "library_id", "movie_id", "episode_id", "track_id", "path", "size", "mtime", "container", "duration", "video_codec", "width", "height", "audio_json", "missing", "updated_at") SELECT "id", "library_id", "movie_id", "episode_id", "track_id", "path", "size", "mtime", "container", "duration", "video_codec", "width", "height", "audio_json", "missing", "updated_at" FROM `media_files`;--> statement-breakpoint
DROP TABLE `media_files`;--> statement-breakpoint
ALTER TABLE `__new_media_files` RENAME TO `media_files`;--> statement-breakpoint
CREATE INDEX `media_files_library` ON `media_files` (`library_id`);--> statement-breakpoint
CREATE INDEX `media_files_movie` ON `media_files` (`movie_id`);--> statement-breakpoint
CREATE INDEX `media_files_episode` ON `media_files` (`episode_id`);--> statement-breakpoint
CREATE INDEX `media_files_track` ON `media_files` (`track_id`);