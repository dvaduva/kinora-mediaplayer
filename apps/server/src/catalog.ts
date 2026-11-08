import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  AudioStream,
  CastMember,
  ContinueItem,
  HomeView,
  IdentifyItem,
  LibraryType,
  LibraryView,
  MediaVersion,
  MovieDetail,
  MovieSummary,
  WatchStatus,
  PersonCredit,
  PlaybackView,
  SearchHit,
  SeriesDetail,
  SeriesSummary,
  SimilarTitle,
  SubtitleTrack,
  Trailer,
} from "@kinora/shared";
import { parseLockedFields, WATCH_STATUSES } from "@kinora/shared";
import { db, parseJson } from "./db/index.js";
import { isNonLatinName, transliterateName } from "./metadata/tmdb.js";
import {
  albums,
  artists,
  episodes,
  libraries,
  mediaFiles,
  movieReviews,
  movieStatus,
  movies,
  progress,
  seasons,
  series,
  subtitleAssets,
  tracks,
} from "./db/schema.js";
import { getScanState } from "./scan.js";
import { chooseSubtitle } from "./playback/choose.js";
import { playbackPlan } from "./playback/plan.js";
import { isInsideRoot } from "./paths.js";
import { tools } from "./process.js";
import { getProfile, PROFILE_ID } from "./settings.js";


/** Rows matched before cast names were latinized may still hold Cyrillic; re-match fetches the proper TMDB form. */
function latinNames(names: string[]) {
  return names.map((name) => (isNonLatinName(name) ? transliterateName(name) : name));
}

function latinCast(cast: CastMember[]) {
  return cast.map((member) => (isNonLatinName(member.name) ? { ...member, name: transliterateName(member.name) } : member));
}

interface StoredSimilar {
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  mediaType: "movie" | "tv";
}

const TEXT_CODECS = new Set(["srt", "vtt", "ass", "ssa", "subrip", "mov_text", "webvtt", "text"]);

export function libraryViews(): LibraryView[] {
  return db
    .select()
    .from(libraries)
    .all()
    .map((library) => ({
      id: library.id,
      name: library.name,
      type: library.type as LibraryType,
      roots: parseJson<string[]>(library.roots, []),
      createdAt: library.createdAt,
      scan: getScanState(library.id),
    }));
}

type MediaFileRow = typeof mediaFiles.$inferSelect;

/**
 * One pass over the present (non-missing) files, episodes and tracks, so list endpoints
 * answer "which titles have files" with map lookups instead of re-reading tables per row.
 */
type Presence = {
  movieFiles: Map<string, MediaFileRow[]>;
  episodeFiles: Map<string, MediaFileRow[]>;
  seriesWithFiles: Set<string>;
  albumsWithFiles: Set<string>;
  artistNames: Map<string, string>;
};

function presence(): Presence {
  const movieFiles = new Map<string, MediaFileRow[]>();
  const episodeFiles = new Map<string, MediaFileRow[]>();
  const trackIds = new Set<string>();
  for (const file of db.select().from(mediaFiles).where(eq(mediaFiles.missing, false)).all()) {
    if (file.movieId) push(movieFiles, file.movieId, file);
    if (file.episodeId) push(episodeFiles, file.episodeId, file);
    if (file.trackId) trackIds.add(file.trackId);
  }
  const seriesWithFiles = new Set<string>();
  for (const episode of db.select({ id: episodes.id, seriesId: episodes.seriesId }).from(episodes).all()) {
    if (episodeFiles.has(episode.id)) seriesWithFiles.add(episode.seriesId);
  }
  const albumsWithFiles = new Set<string>();
  for (const track of db.select({ id: tracks.id, albumId: tracks.albumId }).from(tracks).all()) {
    if (trackIds.has(track.id)) albumsWithFiles.add(track.albumId);
  }
  const artistNames = new Map(db.select({ id: artists.id, name: artists.name }).from(artists).all().map((row) => [row.id, row.name]));
  return { movieFiles, episodeFiles, seriesWithFiles, albumsWithFiles, artistNames };
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function filesForMovie(movieId: string) {
  return db
    .select()
    .from(mediaFiles)
    .where(and(eq(mediaFiles.movieId, movieId), eq(mediaFiles.missing, false)))
    .all();
}

function versionOf(file: typeof mediaFiles.$inferSelect): MediaVersion {
  const audio = parseJson<AudioStream[]>(file.audioJson, []);
  const plan = playbackPlan({
    missing: file.missing,
    kind: file.trackId ? "audio" : "video",
    container: file.container,
    videoCodec: file.videoCodec,
    audioCodec: audio[0]?.codec ?? null,
    ffmpeg: tools.ffmpeg,
  });
  return {
    fileId: file.id,
    filename: path.basename(file.path),
    path: file.path,
    size: file.size,
    duration: file.duration,
    width: file.width,
    height: file.height,
    videoCodec: file.videoCodec,
    audio,
    container: file.container,
    playable: plan.available,
    plan,
    subtitles: db
      .select()
      .from(subtitleAssets)
      .all()
      .filter((asset) => asset.fileId === file.id)
      .map(subtitleDto),
  };
}

function subtitleDto(asset: typeof subtitleAssets.$inferSelect): SubtitleTrack {
  const codec = (asset.codec ?? "").toLowerCase();
  const textBased = TEXT_CODECS.has(codec);
  const needsFfmpeg = asset.origin === "embedded" || codec === "ass" || codec === "ssa";
  const available = textBased && (!needsFfmpeg || tools.ffmpeg);
  return {
    id: asset.id,
    language: asset.language,
    forced: asset.forced,
    hearingImpaired: asset.hearingImpaired,
    origin: asset.origin === "embedded" ? "embedded" : "external",
    textBased,
    available,
    unavailableReason: !textBased ? "bitmap" : !available ? "needs_ffmpeg" : null,
  };
}

function rank(version: MediaVersion) {
  return (version.playable ? 1_000_000_000 : 0) + (version.width ?? 0) * (version.height ?? 0) + version.size / 1_000_000_000;
}

function decorateSimilar(items: StoredSimilar[]): SimilarTitle[] {
  return items.map((item) => {
    if (item.mediaType === "tv") {
      const local = db.select().from(series).all().find((show) => show.tmdbId === item.tmdbId);
      return { ...item, inLibrary: Boolean(local), localId: local?.id ?? null };
    }
    const local = db.select().from(movies).all().find((movie) => movie.tmdbId === item.tmdbId);
    return { ...item, inLibrary: Boolean(local), localId: local?.id ?? null };
  });
}

/** A movie counts as "new" for this long after it appears, unless it was part of the library's first scan. */
const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Movies found within this long after a library was created belong to its initial import, not to later additions. */
const INITIAL_IMPORT_MS = 24 * 60 * 60 * 1000;

/** Per-movie inputs for the watch status, gathered once per request. */
type WatchContext = {
  manual: Map<string, WatchStatus>;
  /** Movie id → whether any of its files was watched to the end. Present only for movies with progress. */
  played: Map<string, boolean>;
  libraryCreated: Map<string, number>;
  /** Movie id → the profile's own star rating. */
  ratings: Map<string, number>;
  now: number;
};

function watchContext(): WatchContext {
  const manual = new Map<string, WatchStatus>();
  for (const row of db.select().from(movieStatus).where(eq(movieStatus.profileId, PROFILE_ID)).all()) {
    if (isWatchStatus(row.status)) manual.set(row.movieId, row.status);
  }
  const played = new Map<string, boolean>();
  const rows = db
    .select({ movieId: mediaFiles.movieId, watched: progress.watched })
    .from(progress)
    .innerJoin(mediaFiles, eq(progress.fileId, mediaFiles.id))
    .where(eq(progress.profileId, PROFILE_ID))
    .all();
  for (const row of rows) {
    if (row.movieId) played.set(row.movieId, (played.get(row.movieId) ?? false) || row.watched);
  }
  const libraryCreated = new Map(db.select({ id: libraries.id, createdAt: libraries.createdAt }).from(libraries).all().map((row) => [row.id, row.createdAt]));
  const ratings = new Map<string, number>();
  for (const row of db.select({ movieId: movieReviews.movieId, rating: movieReviews.rating }).from(movieReviews).where(eq(movieReviews.profileId, PROFILE_ID)).all()) {
    if (row.rating != null) ratings.set(row.movieId, row.rating);
  }
  return { manual, played, libraryCreated, ratings, now: Date.now() };
}

export function isWatchStatus(value: unknown): value is WatchStatus {
  return typeof value === "string" && (WATCH_STATUSES as readonly string[]).includes(value);
}

function watchStatusOf(movie: typeof movies.$inferSelect, context: WatchContext): { status: WatchStatus; manual: boolean } {
  const manual = context.manual.get(movie.id);
  if (manual) return { status: manual, manual: true };
  const played = context.played.get(movie.id);
  if (played) return { status: "watched", manual: false };
  if (played === undefined) {
    const created = context.libraryCreated.get(movie.libraryId) ?? 0;
    const recent = context.now - movie.addedAt < NEW_WINDOW_MS;
    if (recent && movie.addedAt - created > INITIAL_IMPORT_MS) return { status: "new", manual: false };
  }
  return { status: "unwatched", manual: false };
}

function movieSummary(movie: typeof movies.$inferSelect, context = watchContext()): MovieSummary {
  const watch = watchStatusOf(movie, context);
  return {
    id: movie.id,
    title: movie.title,
    year: movie.year,
    posterPath: movie.posterPath,
    rating: movie.rating,
    matched: movie.matched,
    runtime: movie.runtime,
    releaseDate: movie.releaseDate,
    addedAt: movie.addedAt,
    genres: parseJson<string[]>(movie.genresJson, []),
    sortTitle: movie.sortTitle,
    userRating: context.ratings.get(movie.id) ?? null,
    watchStatus: watch.status,
    watchStatusManual: watch.manual,
  };
}

export function listMovies(p = presence()) {
  const context = watchContext();
  return db
    .select()
    .from(movies)
    .all()
    .filter((movie) => p.movieFiles.has(movie.id))
    .sort((a, b) => (a.sortTitle ?? a.title).localeCompare(b.sortTitle ?? b.title))
    .map((movie) => movieSummary(movie, context));
}

/**
 * Sets the watch status by hand. "watched" and "unwatched" also update the playback progress,
 * so Continue Watching and resume points agree with what the user chose.
 */
export function setMovieWatchStatus(movieId: string, status: WatchStatus | null) {
  const movie = db.select().from(movies).where(eq(movies.id, movieId)).get();
  if (!movie) return false;
  const now = Date.now();
  const fileIds = db.select({ id: mediaFiles.id }).from(mediaFiles).where(eq(mediaFiles.movieId, movieId)).all().map((row) => row.id);
  db.transaction((tx) => {
    if (status === null) {
      tx.delete(movieStatus).where(and(eq(movieStatus.profileId, PROFILE_ID), eq(movieStatus.movieId, movieId))).run();
      return;
    }
    tx.insert(movieStatus)
      .values({ profileId: PROFILE_ID, movieId, status, updatedAt: now })
      .onConflictDoUpdate({ target: [movieStatus.profileId, movieStatus.movieId], set: { status, updatedAt: now } })
      .run();
    if (fileIds.length === 0) return;
    const ofMovie = and(eq(progress.profileId, PROFILE_ID), inArray(progress.fileId, fileIds));
    if (status === "watched") {
      tx.update(progress).set({ watched: true, updatedAt: now }).where(ofMovie).run();
    } else {
      // Starting over: drop resume points so the next play begins at 0 and leaves Continue Watching.
      tx.update(progress).set({ watched: false, position: 0, updatedAt: now }).where(ofMovie).run();
    }
  });
  return true;
}

export function movieDetail(id: string): MovieDetail | null {
  const movie = db.select().from(movies).where(eq(movies.id, id)).get();
  const files = movie ? filesForMovie(id) : [];
  if (!movie || files.length === 0) return null;
  const versions = files.map(versionOf).sort((a, b) => rank(b) - rank(a));
  return {
    ...movieSummary(movie),
    edition: movie.edition,
    rtSlug: movie.rtSlug,
    locked: parseLockedFields(movie.lockedJson),
    originalTitle: movie.originalTitle,
    overview: movie.overview,
    tagline: movie.tagline,
    backdropPath: movie.backdropPath,
    directors: latinNames(parseJson<string[]>(movie.directorsJson, [])),
    writers: latinNames(parseJson<string[]>(movie.writersJson, [])),
    cast: latinCast(parseJson<CastMember[]>(movie.castJson, [])),
    stills: parseJson<string[]>(movie.stillsJson, []),
    similar: decorateSimilar(parseJson<StoredSimilar[]>(movie.similarJson, [])),
    trailer: parseJson<Trailer | null>(movie.trailerJson, null),
    imdbId: movie.imdbId,
    tmdbId: movie.tmdbId,
    versions,
    defaultFileId: versions[0]?.fileId ?? null,
  };
}

/** Library titles whose stored cast lists this TMDB person (name match only for rows saved without person ids). */
export function personCredits(tmdbPersonId: number): { credits: PersonCredit[]; fallback: { name: string; profilePath: string | null } | null } {
  let fallback: { name: string; profilePath: string | null } | null = null;
  const roleIn = (castJson: string) => {
    const member = latinCast(parseJson<CastMember[]>(castJson, [])).find((item) => item.tmdbPersonId === tmdbPersonId);
    if (member && !fallback) fallback = { name: member.name, profilePath: member.profilePath };
    return member;
  };
  const credits: PersonCredit[] = [];
  const p = presence();
  for (const movie of db.select().from(movies).all()) {
    const member = roleIn(movie.castJson);
    if (!member || !p.movieFiles.has(movie.id)) continue;
    credits.push({ kind: "movie", id: movie.id, title: movie.title, year: movie.year, posterPath: movie.posterPath, character: member.character });
  }
  for (const show of db.select().from(series).all()) {
    const member = roleIn(show.castJson);
    if (!member || !p.seriesWithFiles.has(show.id)) continue;
    credits.push({ kind: "series", id: show.id, title: show.title, year: show.year, posterPath: show.posterPath, character: member.character });
  }
  credits.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
  return { credits, fallback };
}

export function listSeries(p = presence()): SeriesSummary[] {
  return db
    .select()
    .from(series)
    .all()
    .filter((show) => p.seriesWithFiles.has(show.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((show) => ({
      id: show.id,
      title: show.title,
      year: show.year,
      posterPath: show.posterPath,
      rating: show.rating,
      matched: show.matched,
    }));
}

function presentFile(column: typeof mediaFiles.episodeId | typeof mediaFiles.trackId, id: string) {
  return db
    .select()
    .from(mediaFiles)
    .where(and(eq(column, id), eq(mediaFiles.missing, false)))
    .get();
}

export function seriesDetail(id: string): SeriesDetail | null {
  const show = db.select().from(series).where(eq(series.id, id)).get();
  if (!show) return null;
  const fileByEpisode = new Map<string, MediaFileRow>();
  const episodeRows = db
    .select()
    .from(episodes)
    .where(eq(episodes.seriesId, id))
    .all()
    .filter((episode) => {
      const file = presentFile(mediaFiles.episodeId, episode.id);
      if (file) fileByEpisode.set(episode.id, file);
      return file != null;
    })
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  if (episodeRows.length === 0) return null;
  const seasonRows = db.select().from(seasons).where(eq(seasons.seriesId, id)).all();
  const seasonNumbers = [...new Set(episodeRows.map((episode) => episode.seasonNumber))];
  return {
    id: show.id,
    title: show.title,
    year: show.year,
    posterPath: show.posterPath,
    rating: show.rating,
    matched: show.matched,
    originalTitle: show.originalTitle,
    overview: show.overview,
    backdropPath: show.backdropPath,
    genres: parseJson<string[]>(show.genresJson, []),
    creators: latinNames(parseJson<string[]>(show.creatorsJson, [])),
    cast: latinCast(parseJson<CastMember[]>(show.castJson, [])),
    similar: decorateSimilar(parseJson<StoredSimilar[]>(show.similarJson, [])),
    trailer: parseJson<Trailer | null>(show.trailerJson, null),
    tmdbId: show.tmdbId,
    imdbId: show.imdbId,
    seasons: seasonNumbers.map((seasonNumber) => ({
      seasonNumber,
      name: seasonRows.find((season) => season.seasonNumber === seasonNumber)?.name ?? null,
      episodes: episodeRows
        .filter((episode) => episode.seasonNumber === seasonNumber)
        .map((episode) => {
          const file = fileByEpisode.get(episode.id);
          const version = file ? versionOf(file) : null;
          return {
            id: episode.id,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            overview: episode.overview,
            stillPath: episode.stillPath,
            runtime: episode.runtime,
            airDate: episode.airDate,
            fileId: file?.id ?? null,
            playable: version?.playable ?? false,
          };
        }),
    })),
  };
}

function albumSummary(album: typeof albums.$inferSelect, p: Presence): AlbumSummary | null {
  const artistName = p.artistNames.get(album.artistId);
  if (artistName == null || !p.albumsWithFiles.has(album.id)) return null;
  return {
    id: album.id,
    title: album.title,
    year: album.year,
    coverPath: album.coverPath,
    artistName,
    artistId: album.artistId,
    matched: album.matched,
  };
}

export function listAlbums(p = presence()) {
  return db
    .select()
    .from(albums)
    .all()
    .map((album) => albumSummary(album, p))
    .filter((album): album is AlbumSummary => album != null)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function listArtists(p = presence()) {
  const albumsInLibrary = listAlbums(p);
  const ids = new Set(albumsInLibrary.map((album) => album.artistId));
  return db
    .select()
    .from(artists)
    .all()
    .filter((artist) => ids.has(artist.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((artist) => ({ id: artist.id, name: artist.name }));
}

export function artistDetail(id: string): ArtistDetail | null {
  const artist = db.select().from(artists).where(eq(artists.id, id)).get();
  if (!artist) return null;
  const artistAlbums = listAlbums().filter((album) => album.artistId === id);
  if (artistAlbums.length === 0) return null;
  return { id: artist.id, name: artist.name, albums: artistAlbums };
}

export function albumDetail(id: string): AlbumDetail | null {
  const album = db.select().from(albums).where(eq(albums.id, id)).get();
  if (!album) return null;
  const artist = db.select().from(artists).where(eq(artists.id, album.artistId)).get();
  if (!artist) return null;
  const fileByTrack = new Map<string, MediaFileRow>();
  const albumTracks = db
    .select()
    .from(tracks)
    .where(eq(tracks.albumId, id))
    .all()
    .filter((track) => {
      const file = presentFile(mediaFiles.trackId, track.id);
      if (file) fileByTrack.set(track.id, file);
      return file != null;
    })
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
  if (albumTracks.length === 0) return null;
  return {
    id: album.id,
    title: album.title,
    year: album.year,
    coverPath: album.coverPath,
    artistName: artist.name,
    artistId: artist.id,
    matched: album.matched,
    tracks: albumTracks.map((track) => {
      const file = fileByTrack.get(track.id);
      return {
        id: track.id,
        fileId: file?.id ?? "",
        title: track.title,
        trackNumber: track.trackNumber,
        discNumber: track.discNumber,
        duration: track.duration ?? file?.duration ?? null,
        artistName: track.artistName,
      };
    }),
  };
}

export function homeView(): HomeView {
  const p = presence();
  const moviesInLibrary = db
    .select()
    .from(movies)
    .all()
    .filter((movie) => p.movieFiles.has(movie.id))
    .sort((a, b) => b.addedAt - a.addedAt);
  const context = watchContext();
  const featured = moviesInLibrary.find((movie) => movie.backdropPath) ?? moviesInLibrary[0] ?? null;
  return {
    continueWatching: continueWatching(),
    featured: featured ? movieDetail(featured.id) : null,
    movies: moviesInLibrary.slice(0, 18).map((movie) => movieSummary(movie, context)),
    series: listSeries(p).slice(0, 18),
    albums: listAlbums(p).slice(0, 18),
  };
}

function continueWatching(): ContinueItem[] {
  const items: ContinueItem[] = [];
  const rows = db
    .select()
    .from(progress)
    .all()
    .filter((item) => item.profileId === PROFILE_ID && !item.watched && item.position > 5)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const item of rows) {
    const file = db.select().from(mediaFiles).where(eq(mediaFiles.id, item.fileId)).get();
    if (!file || file.missing) continue;
    const base = { fileId: file.id, position: item.position, duration: item.duration || file.duration || 0 };
    if (file.movieId) {
      const movie = db.select().from(movies).where(eq(movies.id, file.movieId)).get();
      if (!movie) continue;
      items.push({ ...base, title: movie.title, subtitle: movie.year ? String(movie.year) : null, posterPath: movie.posterPath, backdropPath: movie.backdropPath, kind: "movie" });
    } else if (file.episodeId) {
      const episode = db.select().from(episodes).where(eq(episodes.id, file.episodeId)).get();
      const show = episode ? db.select().from(series).where(eq(series.id, episode.seriesId)).get() : null;
      if (!episode || !show) continue;
      items.push({ ...base, title: episode.title, subtitle: show.title, posterPath: show.posterPath, backdropPath: episode.stillPath ?? show.backdropPath, kind: "episode" });
    } else if (file.trackId) {
      const track = db.select().from(tracks).where(eq(tracks.id, file.trackId)).get();
      const album = track ? db.select().from(albums).where(eq(albums.id, track.albumId)).get() : null;
      if (!track || !album) continue;
      items.push({ ...base, title: track.title, subtitle: album.title, posterPath: album.coverPath, backdropPath: album.coverPath, kind: "track" });
    }
  }
  return items.slice(0, 12);
}

export function searchLibrary(query: string): SearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  const p = presence();
  for (const movie of listMovies(p)) {
    if (movie.title.toLocaleLowerCase().includes(needle)) {
      hits.push({ kind: "movie", id: movie.id, title: movie.title, subtitle: movie.year ? String(movie.year) : null, posterPath: movie.posterPath });
    }
  }
  for (const show of listSeries(p)) {
    if (show.title.toLocaleLowerCase().includes(needle)) {
      hits.push({ kind: "series", id: show.id, title: show.title, subtitle: show.year ? String(show.year) : null, posterPath: show.posterPath });
    }
  }
  for (const album of listAlbums(p)) {
    if (album.title.toLocaleLowerCase().includes(needle) || album.artistName.toLocaleLowerCase().includes(needle)) {
      hits.push({ kind: "album", id: album.id, title: album.title, subtitle: album.artistName, posterPath: album.coverPath });
    }
  }
  for (const artist of listArtists(p)) {
    if (artist.name.toLocaleLowerCase().includes(needle)) {
      hits.push({ kind: "artist", id: artist.id, title: artist.name, subtitle: null, posterPath: null });
    }
  }
  return hits.slice(0, 40);
}

export function identifyQueue(): IdentifyItem[] {
  const p = presence();
  const items: IdentifyItem[] = [];
  for (const movie of db.select().from(movies).where(eq(movies.matched, false)).all()) {
    const files = p.movieFiles.get(movie.id);
    if (!files) continue;
    items.push({ kind: "movie", id: movie.id, title: movie.title, year: movie.year, hint: files.map((file) => path.basename(file.path)).join(", ") });
  }
  const episodesBySeries = new Map<string, string[]>();
  for (const episode of db.select({ id: episodes.id, seriesId: episodes.seriesId }).from(episodes).all()) {
    push(episodesBySeries, episode.seriesId, episode.id);
  }
  for (const show of db.select().from(series).where(eq(series.matched, false)).all()) {
    const names = (episodesBySeries.get(show.id) ?? []).flatMap((episodeId) => (p.episodeFiles.get(episodeId) ?? []).map((file) => path.basename(file.path)));
    if (names.length === 0) continue;
    items.push({ kind: "series", id: show.id, title: show.title, year: show.year, hint: names.join(", ") });
  }
  for (const album of db.select().from(albums).where(eq(albums.matched, false)).all()) {
    const summary = albumSummary(album, p);
    if (!summary) continue;
    items.push({ kind: "album", id: album.id, title: album.title, year: album.year, hint: summary.artistName });
  }
  return items;
}

export function playbackView(fileId: string): PlaybackView | null {
  const file = db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get();
  if (!file || file.missing || !resolveMediaPath(file)) return null;
  const version = versionOf(file);
  const saved = db
    .select()
    .from(progress)
    .where(and(eq(progress.profileId, PROFILE_ID), eq(progress.fileId, fileId)))
    .get();
  const profile = getProfile();
  const selected = chooseSubtitle(
    version.subtitles,
    profile.subtitleLanguage,
    saved?.subtitleChoice ?? null,
    version.audio[0]?.language ?? null,
  );
  let title = version.filename;
  let subtitle: string | null = null;
  let backdropPath: string | null = null;
  let kind: PlaybackView["kind"] = "movie";
  if (file.movieId) {
    const movie = db.select().from(movies).where(eq(movies.id, file.movieId)).get();
    if (movie) {
      title = movie.title;
      subtitle = movie.year ? String(movie.year) : null;
      backdropPath = movie.backdropPath;
    }
  } else if (file.episodeId) {
    kind = "episode";
    const episode = db.select().from(episodes).where(eq(episodes.id, file.episodeId)).get();
    const show = episode ? db.select().from(series).where(eq(series.id, episode.seriesId)).get() : null;
    if (episode && show) {
      title = episode.title;
      subtitle = `${show.title}, S${episode.seasonNumber} E${episode.episodeNumber}`;
      backdropPath = episode.stillPath ?? show.backdropPath;
    }
  } else if (file.trackId) {
    kind = "track";
    const track = db.select().from(tracks).where(eq(tracks.id, file.trackId)).get();
    const album = track ? db.select().from(albums).where(eq(albums.id, track.albumId)).get() : null;
    if (track && album) {
      title = track.title;
      subtitle = album.title;
      backdropPath = album.coverPath;
    }
  }
  return {
    fileId,
    title,
    subtitle,
    backdropPath,
    kind,
    plan: version.plan,
    subtitles: version.subtitles,
    selectedSubtitleId: selected,
    resumeSeconds: saved && !saved.watched ? saved.position : 0,
    duration: file.duration,
    subtitleStyle: { size: profile.subtitleSize, color: profile.subtitleColor },
    subtitleDelay: saved?.subtitleDelay ?? 0,
  };
}

export function saveProgress(input: { fileId: string; position: number; duration: number; subtitleChoice: string | null; subtitleDelay?: number }) {
  const file = db.select().from(mediaFiles).where(eq(mediaFiles.id, input.fileId)).get();
  if (!file) return false;
  const watched = input.duration > 0 && input.position / input.duration >= 0.9;
  db.insert(progress)
    .values({
      profileId: PROFILE_ID,
      fileId: input.fileId,
      position: input.position,
      duration: input.duration,
      watched,
      subtitleChoice: input.subtitleChoice,
      subtitleDelay: input.subtitleDelay ?? 0,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [progress.profileId, progress.fileId],
      set: {
        position: input.position,
        duration: input.duration,
        watched,
        subtitleChoice: input.subtitleChoice,
        ...(input.subtitleDelay === undefined ? {} : { subtitleDelay: input.subtitleDelay }),
        updatedAt: Date.now(),
      },
    })
    .run();
  if (file.movieId) clearStaleWatchStatus(file.movieId, watched, input.position);
  return true;
}

/**
 * Playback outranks an older manual mark: finishing the movie makes it watched,
 * and starting a movie marked "new" makes it simply unwatched.
 */
function clearStaleWatchStatus(movieId: string, watched: boolean, position: number) {
  const mark = db
    .select()
    .from(movieStatus)
    .where(and(eq(movieStatus.profileId, PROFILE_ID), eq(movieStatus.movieId, movieId)))
    .get();
  if (!mark) return;
  const stale = (watched && mark.status !== "watched") || (mark.status === "new" && position > 5);
  if (stale) db.delete(movieStatus).where(and(eq(movieStatus.profileId, PROFILE_ID), eq(movieStatus.movieId, movieId))).run();
}

export function resolveMediaPath(file: typeof mediaFiles.$inferSelect) {
  const library = db.select().from(libraries).where(eq(libraries.id, file.libraryId)).get();
  if (!library) return null;
  const roots = parseJson<string[]>(library.roots, []);
  if (!isInsideRoot(file.path, roots) || !fs.existsSync(file.path)) return null;
  return file.path;
}

export function resolveSubtitlePath(fileId: string, subtitleId: string) {
  const file = db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get();
  if (!file || !resolveMediaPath(file)) return null;
  const asset = db.select().from(subtitleAssets).where(eq(subtitleAssets.id, subtitleId)).get();
  if (!asset || asset.fileId !== fileId) return null;
  if (asset.origin === "external" && asset.path) {
    const library = db.select().from(libraries).where(eq(libraries.id, file.libraryId)).get();
    const roots = parseJson<string[]>(library?.roots, []);
    if (!isInsideRoot(asset.path, roots)) return null;
  }
  return { file, asset };
}
