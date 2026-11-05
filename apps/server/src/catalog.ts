import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
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
  PlaybackView,
  SearchHit,
  SeriesDetail,
  SeriesSummary,
  SimilarTitle,
  SubtitleTrack,
  Trailer,
} from "@kinora/shared";
import { db, parseJson } from "./db/index.js";
import {
  albums,
  artists,
  episodes,
  libraries,
  mediaFiles,
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

function filesForMovie(movieId: string) {
  return db
    .select()
    .from(mediaFiles)
    .all()
    .filter((file) => file.movieId === movieId && !file.missing);
}

function visibleMovie(movieId: string) {
  return filesForMovie(movieId).length > 0;
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

function movieSummary(movie: typeof movies.$inferSelect): MovieSummary {
  return {
    id: movie.id,
    title: movie.title,
    year: movie.year,
    posterPath: movie.posterPath,
    rating: movie.rating,
    matched: movie.matched,
  };
}

export function listMovies() {
  return db
    .select()
    .from(movies)
    .all()
    .filter((movie) => visibleMovie(movie.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(movieSummary);
}

export function movieDetail(id: string): MovieDetail | null {
  const movie = db.select().from(movies).where(eq(movies.id, id)).get();
  if (!movie || !visibleMovie(id)) return null;
  const versions = filesForMovie(id).map(versionOf).sort((a, b) => rank(b) - rank(a));
  return {
    ...movieSummary(movie),
    originalTitle: movie.originalTitle,
    overview: movie.overview,
    tagline: movie.tagline,
    runtime: movie.runtime,
    releaseDate: movie.releaseDate,
    backdropPath: movie.backdropPath,
    genres: parseJson<string[]>(movie.genresJson, []),
    directors: parseJson<string[]>(movie.directorsJson, []),
    writers: parseJson<string[]>(movie.writersJson, []),
    cast: parseJson<CastMember[]>(movie.castJson, []),
    stills: parseJson<string[]>(movie.stillsJson, []),
    similar: decorateSimilar(parseJson<StoredSimilar[]>(movie.similarJson, [])),
    trailer: parseJson<Trailer | null>(movie.trailerJson, null),
    imdbId: movie.imdbId,
    tmdbId: movie.tmdbId,
    versions,
    defaultFileId: versions[0]?.fileId ?? null,
  };
}

export function listSeries(): SeriesSummary[] {
  return db
    .select()
    .from(series)
    .all()
    .filter((show) => db.select().from(episodes).all().some((episode) => episode.seriesId === show.id && episodeHasFile(episode.id)))
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

function episodeHasFile(episodeId: string) {
  return db
    .select()
    .from(mediaFiles)
    .all()
    .some((file) => file.episodeId === episodeId && !file.missing);
}

export function seriesDetail(id: string): SeriesDetail | null {
  const show = db.select().from(series).where(eq(series.id, id)).get();
  if (!show) return null;
  const episodeRows = db
    .select()
    .from(episodes)
    .all()
    .filter((episode) => episode.seriesId === id && episodeHasFile(episode.id))
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  if (episodeRows.length === 0) return null;
  const seasonRows = db.select().from(seasons).all().filter((season) => season.seriesId === id);
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
    creators: parseJson<string[]>(show.creatorsJson, []),
    cast: parseJson<CastMember[]>(show.castJson, []),
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
          const file = db
            .select()
            .from(mediaFiles)
            .all()
            .find((item) => item.episodeId === episode.id && !item.missing);
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

function albumSummary(album: typeof albums.$inferSelect): AlbumSummary | null {
  const artist = db.select().from(artists).where(eq(artists.id, album.artistId)).get();
  const hasTrack = db
    .select()
    .from(tracks)
    .all()
    .some((track) => track.albumId === album.id && trackHasFile(track.id));
  if (!artist || !hasTrack) return null;
  return {
    id: album.id,
    title: album.title,
    year: album.year,
    coverPath: album.coverPath,
    artistName: artist.name,
    artistId: artist.id,
    matched: album.matched,
  };
}

function trackHasFile(trackId: string) {
  return db
    .select()
    .from(mediaFiles)
    .all()
    .some((file) => file.trackId === trackId && !file.missing);
}

export function listAlbums() {
  return db
    .select()
    .from(albums)
    .all()
    .map(albumSummary)
    .filter((album): album is AlbumSummary => album != null)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function listArtists() {
  const albumsInLibrary = listAlbums();
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
  const summary = albumSummary(album);
  if (!summary) return null;
  const albumTracks = db
    .select()
    .from(tracks)
    .all()
    .filter((track) => track.albumId === id && trackHasFile(track.id))
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
  return {
    ...summary,
    tracks: albumTracks.map((track) => {
      const file = db
        .select()
        .from(mediaFiles)
        .all()
        .find((item) => item.trackId === track.id && !item.missing);
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
  const moviesInLibrary = db
    .select()
    .from(movies)
    .all()
    .filter((movie) => visibleMovie(movie.id))
    .sort((a, b) => b.addedAt - a.addedAt);
  const featured = moviesInLibrary.find((movie) => movie.backdropPath) ?? moviesInLibrary[0] ?? null;
  return {
    continueWatching: continueWatching(),
    featured: featured ? movieDetail(featured.id) : null,
    movies: moviesInLibrary.slice(0, 18).map(movieSummary),
    series: listSeries().slice(0, 18),
    albums: listAlbums().slice(0, 18),
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
  for (const movie of listMovies()) {
    if (movie.title.toLocaleLowerCase().includes(needle)) {
      hits.push({ kind: "movie", id: movie.id, title: movie.title, subtitle: movie.year ? String(movie.year) : null, posterPath: movie.posterPath });
    }
  }
  for (const show of listSeries()) {
    if (show.title.toLocaleLowerCase().includes(needle)) {
      hits.push({ kind: "series", id: show.id, title: show.title, subtitle: show.year ? String(show.year) : null, posterPath: show.posterPath });
    }
  }
  for (const album of listAlbums()) {
    if (album.title.toLocaleLowerCase().includes(needle) || album.artistName.toLocaleLowerCase().includes(needle)) {
      hits.push({ kind: "album", id: album.id, title: album.title, subtitle: album.artistName, posterPath: album.coverPath });
    }
  }
  for (const artist of listArtists()) {
    if (artist.name.toLocaleLowerCase().includes(needle)) {
      hits.push({ kind: "artist", id: artist.id, title: artist.name, subtitle: null, posterPath: null });
    }
  }
  return hits.slice(0, 40);
}

export function identifyQueue(): IdentifyItem[] {
  const items: IdentifyItem[] = [];
  for (const movie of db.select().from(movies).all()) {
    if (movie.matched || !visibleMovie(movie.id)) continue;
    const names = filesForMovie(movie.id).map((file) => path.basename(file.path));
    items.push({ kind: "movie", id: movie.id, title: movie.title, year: movie.year, hint: names.join(", ") });
  }
  for (const show of db.select().from(series).all()) {
    const owned = db.select().from(episodes).all().filter((episode) => episode.seriesId === show.id && episodeHasFile(episode.id));
    if (show.matched || owned.length === 0) continue;
    const episodeIds = new Set(owned.map((episode) => episode.id));
    const names = db
      .select()
      .from(mediaFiles)
      .all()
      .filter((file) => file.episodeId != null && episodeIds.has(file.episodeId) && !file.missing)
      .map((file) => path.basename(file.path));
    items.push({ kind: "series", id: show.id, title: show.title, year: show.year, hint: names.join(", ") });
  }
  for (const album of db.select().from(albums).all()) {
    const summary = albumSummary(album);
    if (!summary || album.matched) continue;
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
  const selected = chooseSubtitle(
    version.subtitles,
    getProfile().subtitleLanguage,
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
  };
}

export function saveProgress(input: { fileId: string; position: number; duration: number; subtitleChoice: string | null }) {
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
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [progress.profileId, progress.fileId],
      set: {
        position: input.position,
        duration: input.duration,
        watched,
        subtitleChoice: input.subtitleChoice,
        updatedAt: Date.now(),
      },
    })
    .run();
  return true;
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
