import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const libraries = sqliteTable("libraries", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  roots: text("roots").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const movies = sqliteTable("movies", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
  groupKey: text("group_key").notNull(),
  tmdbId: integer("tmdb_id"),
  imdbId: text("imdb_id"),
  title: text("title").notNull(),
  originalTitle: text("original_title"),
  year: integer("year"),
  overview: text("overview"),
  tagline: text("tagline"),
  runtime: integer("runtime"),
  releaseDate: text("release_date"),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
  rating: real("rating"),
  genresJson: text("genres_json").notNull().default("[]"),
  directorsJson: text("directors_json").notNull().default("[]"),
  writersJson: text("writers_json").notNull().default("[]"),
  castJson: text("cast_json").notNull().default("[]"),
  stillsJson: text("stills_json").notNull().default("[]"),
  similarJson: text("similar_json").notNull().default("[]"),
  trailerJson: text("trailer_json"),
  matched: integer("matched", { mode: "boolean" }).notNull().default(false),
  addedAt: integer("added_at").notNull(),
}, (table) => [
  index("movies_library").on(table.libraryId),
]);

export const series = sqliteTable("series", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
  groupKey: text("group_key").notNull(),
  tmdbId: integer("tmdb_id"),
  imdbId: text("imdb_id"),
  title: text("title").notNull(),
  originalTitle: text("original_title"),
  year: integer("year"),
  overview: text("overview"),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
  rating: real("rating"),
  genresJson: text("genres_json").notNull().default("[]"),
  creatorsJson: text("creators_json").notNull().default("[]"),
  castJson: text("cast_json").notNull().default("[]"),
  similarJson: text("similar_json").notNull().default("[]"),
  trailerJson: text("trailer_json"),
  matched: integer("matched", { mode: "boolean" }).notNull().default(false),
  addedAt: integer("added_at").notNull(),
}, (table) => [
  index("series_library").on(table.libraryId),
]);

export const seasons = sqliteTable("seasons", {
  id: text("id").primaryKey(),
  seriesId: text("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  name: text("name"),
  overview: text("overview"),
  posterPath: text("poster_path"),
}, (table) => [
  index("seasons_series").on(table.seriesId),
]);

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  seriesId: text("series_id").notNull().references(() => series.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull(),
  episodeNumber: integer("episode_number").notNull(),
  title: text("title").notNull(),
  overview: text("overview"),
  stillPath: text("still_path"),
  runtime: integer("runtime"),
  airDate: text("air_date"),
}, (table) => [
  index("episodes_series").on(table.seriesId),
]);

export const artists = sqliteTable("artists", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  mbid: text("mbid"),
}, (table) => [
  index("artists_library").on(table.libraryId),
]);

export const albums = sqliteTable("albums", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
  artistId: text("artist_id").notNull().references(() => artists.id, { onDelete: "cascade" }),
  groupKey: text("group_key").notNull(),
  title: text("title").notNull(),
  year: integer("year"),
  coverPath: text("cover_path"),
  mbid: text("mbid"),
  matched: integer("matched", { mode: "boolean" }).notNull().default(false),
  addedAt: integer("added_at").notNull(),
}, (table) => [
  index("albums_library").on(table.libraryId),
  index("albums_artist").on(table.artistId),
]);

export const tracks = sqliteTable("tracks", {
  id: text("id").primaryKey(),
  albumId: text("album_id").notNull().references(() => albums.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  trackNumber: integer("track_number"),
  discNumber: integer("disc_number"),
  artistName: text("artist_name"),
  duration: real("duration"),
}, (table) => [
  index("tracks_album").on(table.albumId),
]);

export const mediaFiles = sqliteTable("media_files", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull().references(() => libraries.id, { onDelete: "cascade" }),
  movieId: text("movie_id").references(() => movies.id, { onDelete: "set null" }),
  episodeId: text("episode_id").references(() => episodes.id, { onDelete: "set null" }),
  trackId: text("track_id").references(() => tracks.id, { onDelete: "set null" }),
  path: text("path").notNull(),
  size: integer("size").notNull(),
  mtime: integer("mtime").notNull(),
  container: text("container"),
  duration: real("duration"),
  videoCodec: text("video_codec"),
  width: integer("width"),
  height: integer("height"),
  audioJson: text("audio_json").notNull().default("[]"),
  missing: integer("missing", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("media_files_library").on(table.libraryId),
  index("media_files_movie").on(table.movieId),
  index("media_files_episode").on(table.episodeId),
  index("media_files_track").on(table.trackId),
]);

export const subtitleAssets = sqliteTable("subtitle_assets", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull().references(() => mediaFiles.id, { onDelete: "cascade" }),
  origin: text("origin").notNull(),
  path: text("path"),
  streamIndex: integer("stream_index"),
  codec: text("codec"),
  language: text("language"),
  forced: integer("forced", { mode: "boolean" }).notNull().default(false),
  hearingImpaired: integer("hearing_impaired", { mode: "boolean" }).notNull().default(false),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
}, (table) => [
  index("subtitle_assets_file").on(table.fileId),
]);

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  subtitleLanguage: text("subtitle_language").notNull(),
});

export const progress = sqliteTable(
  "progress",
  {
    profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull().references(() => mediaFiles.id, { onDelete: "cascade" }),
    position: real("position").notNull(),
    duration: real("duration").notNull(),
    watched: integer("watched", { mode: "boolean" }).notNull(),
    subtitleChoice: text("subtitle_choice"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.fileId] }), index("progress_file").on(table.fileId)],
);
