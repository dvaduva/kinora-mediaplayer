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
  /** Title used for alphabetical sorting, e.g. "Weight" for "The Weight". */
  sortTitle: text("sort_title"),
  edition: text("edition"),
  /** Field names edited by hand; re-matching with TMDB leaves them alone. */
  lockedJson: text("locked_json").notNull().default("[]"),
  /** Rotten Tomatoes path such as "m/the_weight", set by hand when the automatic lookup misses. */
  rtSlug: text("rt_slug"),
  /** Last ratings fetched from IMDb (via OMDb), Rotten Tomatoes and Metacritic. */
  externalRatingsJson: text("external_ratings_json"),
  externalRatingsAt: integer("external_ratings_at"),
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
  overview: text("overview"),
  genresJson: text("genres_json").notNull().default("[]"),
  stylesJson: text("styles_json").notNull().default("[]"),
  recordLabel: text("record_label"),
  rating: real("rating"),
  /** Set after a MusicBrainz/Wikipedia enrich attempt so we do not retry on every open. */
  metaFetchedAt: integer("meta_fetched_at"),
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
  /** First genre tag; "" once read and absent, null while not read yet (rows from before genres were kept). */
  genre: text("genre"),
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
  /** Caption size as a percentage of the player's default. */
  subtitleSize: integer("subtitle_size").notNull().default(100),
  subtitleColor: text("subtitle_color").notNull().default("#ffffff"),
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
    /** Seconds the captions are shifted against the picture for this file; positive shows them later. */
    subtitleDelay: real("subtitle_delay").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.fileId] }), index("progress_file").on(table.fileId)],
);

/** Watch state the user set by hand; without a row the state is derived from progress and the date added. */
export const movieStatus = sqliteTable(
  "movie_status",
  {
    profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    movieId: text("movie_id").notNull().references(() => movies.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.movieId] })],
);

/** The profile's own rating (half stars, 0.5–5) and review text for a movie. */
export const movieReviews = sqliteTable(
  "movie_reviews",
  {
    profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    movieId: text("movie_id").notNull().references(() => movies.id, { onDelete: "cascade" }),
    rating: real("rating"),
    body: text("body"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.movieId] })],
);

/** Live TV channels. Virtual channels are built from library rules; IPTV channels come from playlists. */
export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  number: integer("number").notNull(),
  name: text("name").notNull(),
  /** File name of an uploaded logo under data/channel-logos; null draws one from the name. */
  logoPath: text("logo_path"),
  orderMode: text("order_mode").notNull(),
  /** Seeds the shuffle, so a channel's order survives restarts and regenerations. */
  seed: integer("seed").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  categoryOverride: text("category_override"),
  /** Virtual channels: programs start on this grid (30 = :00 and :30, 60 = the hour); 0 runs them back to back. */
  alignMinutes: integer("align_minutes").notNull().default(0),
  /** What fills the gap before an aligned start: "media" (trailers, music clips) or "upnext" (a card). */
  filler: text("filler").notNull().default("media"),
  /** Set on channels the server generated ("genre:Drama", "series:<id>", "music:Rock"); one per key. */
  autoKey: text("auto_key"),
  /* IPTV channels: imported from a playlist of this source. */
  iptvSourceId: text("iptv_source_id").references(() => iptvSources.id, { onDelete: "cascade" }),
  /** Identity of the entry within its playlist (tvg-id and name), stable across refreshes. */
  iptvKey: text("iptv_key"),
  /** Never sent to clients: the server relays the stream. */
  streamUrl: text("stream_url"),
  tvgId: text("tvg_id"),
  /** Name the playlist gave; while `name` still equals it, a refresh may rename the channel. */
  m3uName: text("m3u_name"),
  /** tvg-logo address; an uploaded logo (logo_path) takes precedence. */
  remoteLogo: text("remote_logo"),
  groupTitle: text("group_title"),
  /** XMLTV channel id chosen by hand; null matches by tvg-id, then by name. */
  epgChannel: text("epg_channel"),
  /** How the EPG was matched on the last refresh: tvg-id, name, manual, or null. */
  epgMatch: text("epg_match"),
  /** Dropped from the playlist on the last refresh; kept (with its favorites) in case it comes back. */
  iptvMissing: integer("iptv_missing", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("channels_iptv_source").on(table.iptvSourceId),
]);

/** IPTV playlists (M3U), each with an optional XMLTV guide. */
export const iptvSources = sqliteTable("iptv_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  m3uUrl: text("m3u_url").notNull(),
  xmltvUrl: text("xmltv_url"),
  /** Guide address the playlist announces itself (url-tvg), used when xmltv_url is empty. */
  playlistEpgUrl: text("playlist_epg_url"),
  refreshedAt: integer("refreshed_at"),
  /** pending | refreshing | ok | error */
  status: text("status").notNull(),
  error: text("error"),
  /** The playlist loaded but the guide did not. */
  epgError: text("epg_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Channels listed by a source's XMLTV guide, offered for matching by hand. */
export const iptvEpgChannels = sqliteTable(
  "iptv_epg_channels",
  {
    sourceId: text("source_id").notNull().references(() => iptvSources.id, { onDelete: "cascade" }),
    epgId: text("epg_id").notNull(),
    name: text("name").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sourceId, table.epgId] })],
);

/** Per-profile view of the channels: favorites and the profile's own channel order. */
export const profileChannels = sqliteTable(
  "profile_channels",
  {
    profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    /** Place in the profile's order; null follows the channel number. */
    position: integer("position"),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.channelId] })],
);

/** Rules of a virtual channel; the channel plays everything any rule matches. */
export const channelSources = sqliteTable("channel_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  value: text("value").notNull(),
}, (table) => [
  index("channel_sources_channel").on(table.channelId),
]);

/** The materialized schedule: what each channel airs, in epoch milliseconds. */
export const channelPrograms = sqliteTable("channel_programs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  start: integer("start").notNull(),
  end: integer("end").notNull(),
  /** Position in the channel's endless play order; the next program continues from here. */
  seq: integer("seq").notNull(),
  itemType: text("item_type").notNull(),
  itemId: text("item_id"),
  fileId: text("file_id"),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  description: text("description"),
  image: text("image"),
}, (table) => [
  index("channel_programs_channel_start").on(table.channelId, table.start),
]);
