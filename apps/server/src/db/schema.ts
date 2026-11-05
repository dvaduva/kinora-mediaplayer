import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  libraryId: text("library_id").notNull(),
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
  genresJson: text("genres_json").notNull(),
  directorsJson: text("directors_json").notNull(),
  writersJson: text("writers_json").notNull(),
  castJson: text("cast_json").notNull(),
  stillsJson: text("stills_json").notNull(),
  similarJson: text("similar_json").notNull(),
  trailerJson: text("trailer_json"),
  matched: integer("matched", { mode: "boolean" }).notNull(),
  addedAt: integer("added_at").notNull(),
});

export const series = sqliteTable("series", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull(),
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
  genresJson: text("genres_json").notNull(),
  creatorsJson: text("creators_json").notNull(),
  castJson: text("cast_json").notNull(),
  similarJson: text("similar_json").notNull(),
  trailerJson: text("trailer_json"),
  matched: integer("matched", { mode: "boolean" }).notNull(),
  addedAt: integer("added_at").notNull(),
});

export const seasons = sqliteTable("seasons", {
  id: text("id").primaryKey(),
  seriesId: text("series_id").notNull(),
  seasonNumber: integer("season_number").notNull(),
  name: text("name"),
  overview: text("overview"),
  posterPath: text("poster_path"),
});

export const episodes = sqliteTable("episodes", {
  id: text("id").primaryKey(),
  seriesId: text("series_id").notNull(),
  seasonNumber: integer("season_number").notNull(),
  episodeNumber: integer("episode_number").notNull(),
  title: text("title").notNull(),
  overview: text("overview"),
  stillPath: text("still_path"),
  runtime: integer("runtime"),
  airDate: text("air_date"),
});

export const artists = sqliteTable("artists", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  mbid: text("mbid"),
});

export const albums = sqliteTable("albums", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull(),
  artistId: text("artist_id").notNull(),
  groupKey: text("group_key").notNull(),
  title: text("title").notNull(),
  year: integer("year"),
  coverPath: text("cover_path"),
  mbid: text("mbid"),
  matched: integer("matched", { mode: "boolean" }).notNull(),
  addedAt: integer("added_at").notNull(),
});

export const tracks = sqliteTable("tracks", {
  id: text("id").primaryKey(),
  albumId: text("album_id").notNull(),
  title: text("title").notNull(),
  trackNumber: integer("track_number"),
  discNumber: integer("disc_number"),
  artistName: text("artist_name"),
  duration: real("duration"),
});

export const mediaFiles = sqliteTable("media_files", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull(),
  movieId: text("movie_id"),
  episodeId: text("episode_id"),
  trackId: text("track_id"),
  path: text("path").notNull(),
  size: integer("size").notNull(),
  mtime: integer("mtime").notNull(),
  container: text("container"),
  duration: real("duration"),
  videoCodec: text("video_codec"),
  width: integer("width"),
  height: integer("height"),
  audioJson: text("audio_json").notNull(),
  missing: integer("missing", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const subtitleAssets = sqliteTable("subtitle_assets", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull(),
  origin: text("origin").notNull(),
  path: text("path"),
  streamIndex: integer("stream_index"),
  codec: text("codec"),
  language: text("language"),
  forced: integer("forced", { mode: "boolean" }).notNull(),
  hearingImpaired: integer("hearing_impaired", { mode: "boolean" }).notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull(),
});

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  subtitleLanguage: text("subtitle_language").notNull(),
});

export const progress = sqliteTable(
  "progress",
  {
    profileId: text("profile_id").notNull(),
    fileId: text("file_id").notNull(),
    position: real("position").notNull(),
    duration: real("duration").notNull(),
    watched: integer("watched", { mode: "boolean" }).notNull(),
    subtitleChoice: text("subtitle_choice"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.fileId] })],
);
