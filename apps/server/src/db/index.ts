import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { dbPath, ensureDataDirs } from "../paths.js";

ensureDataDirs();

export const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  roots TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  tmdb_id INTEGER,
  imdb_id TEXT,
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  overview TEXT,
  tagline TEXT,
  runtime INTEGER,
  release_date TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  rating REAL,
  genres_json TEXT NOT NULL DEFAULT '[]',
  directors_json TEXT NOT NULL DEFAULT '[]',
  writers_json TEXT NOT NULL DEFAULT '[]',
  cast_json TEXT NOT NULL DEFAULT '[]',
  stills_json TEXT NOT NULL DEFAULT '[]',
  similar_json TEXT NOT NULL DEFAULT '[]',
  trailer_json TEXT,
  matched INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  tmdb_id INTEGER,
  imdb_id TEXT,
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  overview TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  rating REAL,
  genres_json TEXT NOT NULL DEFAULT '[]',
  creators_json TEXT NOT NULL DEFAULT '[]',
  cast_json TEXT NOT NULL DEFAULT '[]',
  similar_json TEXT NOT NULL DEFAULT '[]',
  trailer_json TEXT,
  matched INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  name TEXT,
  overview TEXT,
  poster_path TEXT
);
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  overview TEXT,
  still_path TEXT,
  runtime INTEGER,
  air_date TEXT
);
CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  mbid TEXT
);
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  cover_path TEXT,
  mbid TEXT,
  matched INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL,
  title TEXT NOT NULL,
  track_number INTEGER,
  disc_number INTEGER,
  artist_name TEXT,
  duration REAL
);
CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  movie_id TEXT,
  episode_id TEXT,
  track_id TEXT,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  container TEXT,
  duration REAL,
  video_codec TEXT,
  width INTEGER,
  height INTEGER,
  audio_json TEXT NOT NULL DEFAULT '[]',
  missing INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subtitle_assets (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  path TEXT,
  stream_index INTEGER,
  codec TEXT,
  language TEXT,
  forced INTEGER NOT NULL DEFAULT 0,
  hearing_impaired INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subtitle_language TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
  profile_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  position REAL NOT NULL,
  duration REAL NOT NULL,
  watched INTEGER NOT NULL,
  subtitle_choice TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, file_id)
);
CREATE INDEX IF NOT EXISTS media_files_library ON media_files(library_id);
CREATE INDEX IF NOT EXISTS media_files_movie ON media_files(movie_id);
CREATE INDEX IF NOT EXISTS media_files_episode ON media_files(episode_id);
CREATE INDEX IF NOT EXISTS media_files_track ON media_files(track_id);
`);

export const db = drizzle(sqlite, { schema });

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
