import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { LibraryType, ScanState } from "@kinora/shared";
import { watch, type FSWatcher } from "chokidar";
import { parseFile } from "music-metadata";
import { db, sqlite } from "./db/index.js";
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
import { stableId } from "./id.js";
import { downloadReleaseCover, searchReleases } from "./metadata/musicbrainz.js";
import { chooseMatch, fetchMovie, fetchSeason, fetchSeries, searchMovies, searchSeries } from "./metadata/tmdb.js";
import {
  AUDIO_EXTENSIONS,
  VIDEO_EXTENSIONS,
  discoverExternalSubtitles,
  extensionOf,
  normalizeKey,
  parseMovieName,
  parseMusicPath,
  parseSeriesFile,
  walkFiles,
  type ExternalSubtitle,
} from "./parse/names.js";
import { dataDir, pathKey } from "./paths.js";
import { probeFile, type EmbeddedSubtitle } from "./probe.js";
import { getSetting } from "./settings.js";

const states = new Map<string, ScanState>();
const running = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();
const watchers: FSWatcher[] = [];

function enqueue<T>(task: () => Promise<T>) {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function getScanState(libraryId: string): ScanState {
  return states.get(libraryId) ?? { libraryId, status: "idle", scanned: 0, matched: 0, message: null };
}

export function startScan(libraryId: string) {
  if (running.has(libraryId)) return false;
  running.add(libraryId);
  states.set(libraryId, { libraryId, status: "running", scanned: 0, matched: 0, message: null });
  void enqueue(async () => {
    try {
      await scanLibrary(libraryId);
    } catch (error) {
      const previous = getScanState(libraryId);
      states.set(libraryId, {
        libraryId,
        status: "error",
        scanned: previous.scanned,
        matched: previous.matched,
        message: error instanceof Error ? error.message : "scan_failed",
      });
    } finally {
      running.delete(libraryId);
    }
  });
  return true;
}

export function createLibrary(input: { name: string; type: LibraryType; roots: string[] }) {
  const id = randomUUID();
  db.insert(libraries)
    .values({
      id,
      name: input.name.trim(),
      type: input.type,
      roots: JSON.stringify(input.roots.map((root) => path.resolve(root.trim())).filter(Boolean)),
      createdAt: Date.now(),
    })
    .run();
  void restartWatches();
  startScan(id);
  return id;
}

export function deleteLibrary(id: string) {
  const files = db.select().from(mediaFiles).where(eq(mediaFiles.libraryId, id)).all();
  const remove = sqlite.transaction(() => {
    for (const file of files) {
      db.delete(subtitleAssets).where(eq(subtitleAssets.fileId, file.id)).run();
      db.delete(progress).where(eq(progress.fileId, file.id)).run();
    }
    db.delete(mediaFiles).where(eq(mediaFiles.libraryId, id)).run();
    for (const show of db.select().from(series).where(eq(series.libraryId, id)).all()) {
      db.delete(episodes).where(eq(episodes.seriesId, show.id)).run();
      db.delete(seasons).where(eq(seasons.seriesId, show.id)).run();
    }
    db.delete(series).where(eq(series.libraryId, id)).run();
    db.delete(movies).where(eq(movies.libraryId, id)).run();
    for (const album of db.select().from(albums).where(eq(albums.libraryId, id)).all()) {
      db.delete(tracks).where(eq(tracks.albumId, album.id)).run();
    }
    db.delete(albums).where(eq(albums.libraryId, id)).run();
    db.delete(artists).where(eq(artists.libraryId, id)).run();
    db.delete(libraries).where(eq(libraries.id, id)).run();
  });
  remove();
  states.delete(id);
  void restartWatches();
}

export async function matchMovie(movieId: string, tmdbId: number) {
  // Manual identify must not wait behind a full library scan.
  await enrichMovie(movieId, tmdbId);
}

export async function matchSeries(seriesId: string, tmdbId: number) {
  await enrichSeries(seriesId, tmdbId);
  const owned = db.select().from(episodes).where(eq(episodes.seriesId, seriesId)).all();
  const seasonsPresent = [...new Set(owned.map((episode) => episode.seasonNumber).filter((season) => season > 0))];
  // Season episode art can finish after the match response.
  void (async () => {
    for (const seasonNumber of seasonsPresent) {
      try {
        await applySeason(seriesId, tmdbId, seasonNumber);
      } catch {
        // Keep the series match even if a season refresh fails.
      }
    }
  })();
}

export async function matchAlbum(albumId: string, mbid: string) {
  const album = db.select().from(albums).where(eq(albums.id, albumId)).get();
  if (!album) throw new Error("not_found");
  const cover = album.coverPath ?? (await downloadReleaseCover(mbid, albumId));
  db.update(albums).set({ mbid, coverPath: cover, matched: true }).where(eq(albums.id, albumId)).run();
}

export async function restartWatches() {
  await Promise.all(watchers.splice(0).map((watcher) => watcher.close().catch(() => undefined)));
  for (const library of db.select().from(libraries).all()) {
    const roots = (JSON.parse(library.roots) as string[]).filter((root) => fs.existsSync(root));
    if (roots.length === 0) continue;
    const watcher = watch(roots, {
      ignoreInitial: true,
      // Native recursive watches die on Windows for large or remote folders and take the process with them.
      usePolling: process.platform === "win32",
      interval: 10_000,
      binaryInterval: 10_000,
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    });
    let timer: NodeJS.Timeout | undefined;
    const kick = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => startScan(library.id), 1500);
    };
    watcher.on("error", (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Library watch failed for ${library.name}: ${message}`);
    });
    watcher.on("add", kick).on("change", kick).on("unlink", kick);
    watchers.push(watcher);
  }
}

function owningRoot(file: string, roots: string[]) {
  const resolved = path.resolve(file);
  return (
    roots
      .map((root) => path.resolve(root))
      .filter((root) => {
        const relative = path.relative(root, resolved);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      })
      .sort((a, b) => b.length - a.length)[0] ?? roots[0] ?? resolved
  );
}

async function scanLibrary(libraryId: string) {
  const library = db.select().from(libraries).where(eq(libraries.id, libraryId)).get();
  if (!library) throw new Error("not_found");
  const roots = JSON.parse(library.roots) as string[];
  const missingRoots = roots.filter((root) => !fs.existsSync(root));
  const seen = new Set<string>();
  let scanned = 0;
  let matched = 0;
  let errors = 0;
  const touchedSeasons = new Set<string>();
  const type = library.type as LibraryType;

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for await (const file of walkFiles(root)) {
      const extension = extensionOf(file);
      const allowed = type === "music" ? AUDIO_EXTENSIONS.has(extension) : VIDEO_EXTENSIONS.has(extension);
      if (!allowed) continue;
      seen.add(pathKey(file));
      try {
        const didMatch = await ingestFile(library.id, type, file, owningRoot(file, roots), touchedSeasons);
        if (didMatch) matched += 1;
      } catch {
        errors += 1;
      }
      scanned += 1;
      states.set(libraryId, { libraryId, status: "running", scanned, matched, message: null });
    }
  }

  for (const file of db.select().from(mediaFiles).where(eq(mediaFiles.libraryId, libraryId)).all()) {
    if (!seen.has(pathKey(file.path))) {
      db.update(mediaFiles).set({ missing: true, updatedAt: Date.now() }).where(eq(mediaFiles.id, file.id)).run();
    }
  }
  deleteOrphans(libraryId);
  const message = [
    missingRoots.length ? `Folder not found: ${missingRoots.join(", ")}` : null,
    errors ? `${errors} files could not be read` : null,
  ]
    .filter(Boolean)
    .join(". ");
  states.set(libraryId, {
    libraryId,
    status: missingRoots.length === roots.length && roots.length > 0 ? "error" : "done",
    scanned,
    matched,
    message: message || null,
  });
}

async function ingestFile(libraryId: string, type: LibraryType, file: string, root: string, touchedSeasons: Set<string>) {
  const stat = fs.statSync(file);
  const fileId = stableId("file", pathKey(file));
  const existing = db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get();
  const unchanged =
    existing && existing.size === stat.size && existing.mtime === Math.round(stat.mtimeMs) && !existing.missing;
  if (unchanged) {
    refreshExternalSubtitles(fileId, file);
    if (existing.movieId) return Boolean(db.select().from(movies).where(eq(movies.id, existing.movieId)).get()?.matched);
    if (existing.episodeId) {
      const episode = db.select().from(episodes).where(eq(episodes.id, existing.episodeId)).get();
      return episode ? Boolean(db.select().from(series).where(eq(series.id, episode.seriesId)).get()?.matched) : false;
    }
    if (existing.trackId) {
      const track = db.select().from(tracks).where(eq(tracks.id, existing.trackId)).get();
      return track ? Boolean(db.select().from(albums).where(eq(albums.id, track.albumId)).get()?.matched) : false;
    }
    return false;
  }

  if (type === "music") return ingestMusic(libraryId, file, root, fileId, stat);
  const probed = await probeFile(file);
  const audio = probed?.audio ?? [];
  const now = Date.now();
  const base = {
    id: fileId,
    libraryId,
    path: path.resolve(file),
    size: stat.size,
    mtime: Math.round(stat.mtimeMs),
    container: extensionOf(file),
    duration: probed?.duration ?? null,
    videoCodec: probed?.videoCodec ?? null,
    width: probed?.width ?? null,
    height: probed?.height ?? null,
    audioJson: JSON.stringify(audio),
    missing: false,
    updatedAt: now,
  };

  if (type === "movie") {
    const parsed = parseMovieName(path.basename(file));
    const groupKey = parsed.year ? `${normalizeKey(parsed.title)}|${parsed.year}` : `file|${pathKey(file)}`;
    const movieId = stableId("movie", `${libraryId}|${groupKey}`);
    ensureMovie(libraryId, movieId, groupKey, parsed.title || path.basename(file), parsed.year);
    writeFile({ ...base, movieId, episodeId: null, trackId: null });
    replaceSubtitles(fileId, file, probed?.subtitles ?? []);
    const movie = db.select().from(movies).where(eq(movies.id, movieId)).get();
    if (movie && !movie.matched && getSetting("tmdbReadToken")) {
      const hits = await searchMovies(parsed.title, parsed.year);
      const chosen = chooseMatch(parsed.title, parsed.year, hits);
      if (chosen) await enrichMovie(movieId, chosen.tmdbId);
    }
    return Boolean(db.select().from(movies).where(eq(movies.id, movieId)).get()?.matched);
  }

  const parsed = parseSeriesFile(file, root);
  const groupKey = `${normalizeKey(parsed.showTitle)}|${parsed.year ?? ""}`;
  const seriesId = stableId("series", `${libraryId}|${groupKey}`);
  ensureSeries(libraryId, seriesId, groupKey, parsed.showTitle, parsed.year);
  const episodeId =
    parsed.episode > 0
      ? stableId("episode", `${seriesId}|${parsed.season}|${parsed.episode}`)
      : stableId("episode", `${seriesId}|${pathKey(file)}`);
  ensureEpisode(seriesId, episodeId, parsed);
  writeFile({ ...base, movieId: null, episodeId, trackId: null });
  replaceSubtitles(fileId, file, probed?.subtitles ?? []);
  let show = db.select().from(series).where(eq(series.id, seriesId)).get();
  if (show && !show.matched && getSetting("tmdbReadToken")) {
    const hits = await searchSeries(parsed.showTitle, parsed.year);
    const chosen = chooseMatch(parsed.showTitle, parsed.year, hits);
    if (chosen) {
      await enrichSeries(seriesId, chosen.tmdbId);
      show = db.select().from(series).where(eq(series.id, seriesId)).get();
    }
  }
  const seasonKey = `${seriesId}|${parsed.season}`;
  if (show?.matched && show.tmdbId && parsed.season > 0 && parsed.episode > 0 && !touchedSeasons.has(seasonKey)) {
    touchedSeasons.add(seasonKey);
    await applySeason(seriesId, show.tmdbId, parsed.season);
  }
  return Boolean(show?.matched);
}

async function ingestMusic(libraryId: string, file: string, root: string, fileId: string, stat: fs.Stats) {
  const tags = await readTags(file);
  const fromPath = parseMusicPath(file, root);
  const artistName = tags?.albumArtist || tags?.artist || fromPath.artist || "Necunoscut";
  const albumTitle = tags?.album || fromPath.album || tags?.title || fromPath.title || path.basename(file);
  const weak = artistName === "Necunoscut" || (!tags?.album && !fromPath.album);
  const artistKey = normalizeKey(artistName) || "necunoscut";
  const artistId = stableId("artist", `${libraryId}|${artistKey}`);
  const groupKey = weak ? `file|${pathKey(file)}` : `${artistKey}|${normalizeKey(albumTitle)}`;
  const albumId = stableId("album", `${libraryId}|${groupKey}`);
  const trackId = stableId("track", pathKey(file));
  db.insert(artists)
    .values({ id: artistId, libraryId, name: artistName, nameKey: artistKey, mbid: null })
    .onConflictDoUpdate({ target: artists.id, set: { name: artistName, nameKey: artistKey } })
    .run();
  const existingAlbum = db.select().from(albums).where(eq(albums.id, albumId)).get();
  let cover = existingAlbum?.coverPath ?? null;
  let mbid = existingAlbum?.mbid ?? null;
  if (tags?.picture) cover = savePicture(albumId, tags.picture);
  else if (!cover && !weak) {
    try {
      const releases = await searchReleases(artistName, albumTitle);
      const chosen = releases[0];
      if (chosen) {
        cover = (await downloadReleaseCover(chosen.mbid, albumId)) ?? cover;
        mbid = chosen.mbid;
      }
    } catch {
      // Tags already identify the album. A cover lookup can fail without hiding the music.
    }
  }
  const now = Date.now();
  db.insert(albums)
    .values({
      id: albumId,
      libraryId,
      artistId,
      groupKey,
      title: albumTitle,
      year: tags?.year ?? existingAlbum?.year ?? null,
      coverPath: cover,
      mbid,
      matched: !weak,
      addedAt: existingAlbum?.addedAt ?? now,
    })
    .onConflictDoUpdate({
      target: albums.id,
      set: { title: albumTitle, year: tags?.year ?? existingAlbum?.year ?? null, coverPath: cover, mbid, matched: !weak, artistId },
    })
    .run();
  db.insert(tracks)
    .values({
      id: trackId,
      albumId,
      title: tags?.title || fromPath.title || stripBase(file),
      trackNumber: tags?.trackNumber ?? fromPath.trackNumber,
      discNumber: tags?.discNumber ?? 1,
      artistName: tags?.artist || artistName,
      duration: tags?.duration ?? null,
    })
    .onConflictDoUpdate({
      target: tracks.id,
      set: {
        albumId,
        title: tags?.title || fromPath.title || stripBase(file),
        trackNumber: tags?.trackNumber ?? fromPath.trackNumber,
        discNumber: tags?.discNumber ?? 1,
        artistName: tags?.artist || artistName,
        duration: tags?.duration ?? null,
      },
    })
    .run();
  writeFile({
    id: fileId,
    libraryId,
    movieId: null,
    episodeId: null,
    trackId,
    path: path.resolve(file),
    size: stat.size,
    mtime: Math.round(stat.mtimeMs),
    container: extensionOf(file),
    duration: tags?.duration ?? null,
    videoCodec: null,
    width: null,
    height: null,
    audioJson: JSON.stringify([]),
    missing: false,
    updatedAt: now,
  });
  return !weak;
}

function stripBase(file: string) {
  return path.basename(file, path.extname(file));
}

async function readTags(file: string) {
  try {
    const data = await parseFile(file, { duration: true });
    const picture = data.common.picture?.[0];
    return {
      title: data.common.title ?? null,
      album: data.common.album ?? null,
      artist: data.common.artist ?? null,
      albumArtist: data.common.albumartist ?? null,
      year: data.common.year ?? null,
      trackNumber: data.common.track?.no ?? null,
      discNumber: data.common.disk?.no ?? null,
      duration: data.format.duration ?? null,
      picture: picture ? { data: Buffer.from(picture.data), format: picture.format ?? "image/jpeg" } : null,
    };
  } catch {
    return null;
  }
}

function savePicture(albumId: string, picture: { data: Buffer; format: string }) {
  const filename = `${albumId}.${picture.format.includes("png") ? "png" : "jpg"}`;
  const destination = path.join(dataDir, "cache", "covers", filename);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, picture.data);
  return `cover:${filename}`;
}

function ensureMovie(libraryId: string, movieId: string, groupKey: string, title: string, year: number | null) {
  const existing = db.select().from(movies).where(eq(movies.id, movieId)).get();
  if (!existing) {
    db.insert(movies)
      .values({
        id: movieId,
        libraryId,
        groupKey,
        tmdbId: null,
        imdbId: null,
        title,
        originalTitle: null,
        year,
        overview: null,
        tagline: null,
        runtime: null,
        releaseDate: null,
        posterPath: null,
        backdropPath: null,
        rating: null,
        genresJson: "[]",
        directorsJson: "[]",
        writersJson: "[]",
        castJson: "[]",
        stillsJson: "[]",
        similarJson: "[]",
        trailerJson: null,
        matched: false,
        addedAt: Date.now(),
      })
      .run();
    return;
  }
  if (!existing.matched) {
    db.update(movies).set({ title, year }).where(eq(movies.id, movieId)).run();
  }
}

function ensureSeries(libraryId: string, seriesId: string, groupKey: string, title: string, year: number | null) {
  const existing = db.select().from(series).where(eq(series.id, seriesId)).get();
  if (!existing) {
    db.insert(series)
      .values({
        id: seriesId,
        libraryId,
        groupKey,
        tmdbId: null,
        imdbId: null,
        title,
        originalTitle: null,
        year,
        overview: null,
        posterPath: null,
        backdropPath: null,
        rating: null,
        genresJson: "[]",
        creatorsJson: "[]",
        castJson: "[]",
        similarJson: "[]",
        trailerJson: null,
        matched: false,
        addedAt: Date.now(),
      })
      .run();
    return;
  }
  if (!existing.matched) db.update(series).set({ title, year }).where(eq(series.id, seriesId)).run();
}

function ensureEpisode(
  seriesId: string,
  episodeId: string,
  parsed: { season: number; episode: number; episodeTitle: string | null },
) {
  const existing = db.select().from(episodes).where(eq(episodes.id, episodeId)).get();
  const title = parsed.episodeTitle || (parsed.episode > 0 ? `Episodul ${parsed.episode}` : "Fără număr");
  if (!existing) {
    db.insert(episodes)
      .values({
        id: episodeId,
        seriesId,
        seasonNumber: parsed.season,
        episodeNumber: parsed.episode,
        title,
        overview: null,
        stillPath: null,
        runtime: null,
        airDate: null,
      })
      .run();
    return;
  }
  if (!existing.overview) {
    db.update(episodes)
      .set({ title, seasonNumber: parsed.season, episodeNumber: parsed.episode })
      .where(eq(episodes.id, episodeId))
      .run();
  }
}

function writeFile(row: typeof mediaFiles.$inferInsert) {
  db.insert(mediaFiles)
    .values(row)
    .onConflictDoUpdate({
      target: mediaFiles.id,
      set: {
        libraryId: row.libraryId,
        movieId: row.movieId,
        episodeId: row.episodeId,
        trackId: row.trackId,
        path: row.path,
        size: row.size,
        mtime: row.mtime,
        container: row.container,
        duration: row.duration,
        videoCodec: row.videoCodec,
        width: row.width,
        height: row.height,
        audioJson: row.audioJson,
        missing: false,
        updatedAt: row.updatedAt,
      },
    })
    .run();
}

function replaceSubtitles(fileId: string, videoPath: string, embedded: EmbeddedSubtitle[]) {
  db.delete(subtitleAssets).where(eq(subtitleAssets.fileId, fileId)).run();
  for (const subtitle of discoverExternalSubtitles(videoPath)) insertExternal(fileId, subtitle);
  for (const subtitle of embedded) {
    db.insert(subtitleAssets)
      .values({
        id: stableId("sub", `${fileId}|embedded|${subtitle.streamIndex}`),
        fileId,
        origin: "embedded",
        path: null,
        streamIndex: subtitle.streamIndex,
        codec: subtitle.codec,
        language: subtitle.language,
        forced: subtitle.forced,
        hearingImpaired: subtitle.hearingImpaired,
        isDefault: subtitle.isDefault,
      })
      .run();
  }
}

function refreshExternalSubtitles(fileId: string, videoPath: string) {
  db.delete(subtitleAssets)
    .where(and(eq(subtitleAssets.fileId, fileId), eq(subtitleAssets.origin, "external")))
    .run();
  for (const subtitle of discoverExternalSubtitles(videoPath)) insertExternal(fileId, subtitle);
}

function insertExternal(fileId: string, subtitle: ExternalSubtitle) {
  db.insert(subtitleAssets)
    .values({
      id: stableId("sub", `${fileId}|external|${pathKey(subtitle.path)}`),
      fileId,
      origin: "external",
      path: subtitle.path,
      streamIndex: null,
      codec: subtitle.format,
      language: subtitle.language,
      forced: subtitle.forced,
      hearingImpaired: subtitle.hearingImpaired,
      isDefault: false,
    })
    .run();
}

async function enrichMovie(movieId: string, tmdbId: number) {
  const metadata = await fetchMovie(tmdbId);
  db.update(movies)
    .set({
      tmdbId: metadata.tmdbId,
      imdbId: metadata.imdbId,
      title: metadata.title,
      originalTitle: metadata.originalTitle,
      year: metadata.year,
      overview: metadata.overview,
      tagline: metadata.tagline,
      runtime: metadata.runtime,
      releaseDate: metadata.releaseDate,
      posterPath: metadata.posterPath,
      backdropPath: metadata.backdropPath,
      rating: metadata.rating,
      genresJson: JSON.stringify(metadata.genres),
      directorsJson: JSON.stringify(metadata.directors),
      writersJson: JSON.stringify(metadata.writers),
      castJson: JSON.stringify(metadata.cast),
      stillsJson: JSON.stringify(metadata.stills),
      similarJson: JSON.stringify(metadata.similar),
      trailerJson: metadata.trailer ? JSON.stringify(metadata.trailer) : null,
      matched: true,
    })
    .where(eq(movies.id, movieId))
    .run();
}

async function enrichSeries(seriesId: string, tmdbId: number) {
  const metadata = await fetchSeries(tmdbId);
  db.update(series)
    .set({
      tmdbId: metadata.tmdbId,
      imdbId: metadata.imdbId,
      title: metadata.title,
      originalTitle: metadata.originalTitle,
      year: metadata.year,
      overview: metadata.overview,
      posterPath: metadata.posterPath,
      backdropPath: metadata.backdropPath,
      rating: metadata.rating,
      genresJson: JSON.stringify(metadata.genres),
      creatorsJson: JSON.stringify(metadata.creators),
      castJson: JSON.stringify(metadata.cast),
      similarJson: JSON.stringify(metadata.similar),
      trailerJson: metadata.trailer ? JSON.stringify(metadata.trailer) : null,
      matched: true,
    })
    .where(eq(series.id, seriesId))
    .run();
}

async function applySeason(seriesId: string, tmdbId: number, seasonNumber: number) {
  const season = await fetchSeason(tmdbId, seasonNumber);
  const seasonId = stableId("season", `${seriesId}|${seasonNumber}`);
  db.insert(seasons)
    .values({
      id: seasonId,
      seriesId,
      seasonNumber,
      name: season.name,
      overview: season.overview,
      posterPath: season.posterPath,
    })
    .onConflictDoUpdate({
      target: seasons.id,
      set: { name: season.name, overview: season.overview, posterPath: season.posterPath },
    })
    .run();
  const owned = db
    .select()
    .from(episodes)
    .where(and(eq(episodes.seriesId, seriesId), eq(episodes.seasonNumber, seasonNumber)))
    .all();
  for (const episode of owned) {
    const remote = season.episodes.find((item) => item.episodeNumber === episode.episodeNumber);
    if (!remote || episode.episodeNumber <= 0) continue;
    db.update(episodes)
      .set({
        title: remote.title,
        overview: remote.overview,
        stillPath: remote.stillPath,
        runtime: remote.runtime,
        airDate: remote.airDate,
      })
      .where(eq(episodes.id, episode.id))
      .run();
  }
}

function deleteOrphans(libraryId: string) {
  const files = db.select().from(mediaFiles).where(eq(mediaFiles.libraryId, libraryId)).all();
  const movieIds = new Set(files.map((file) => file.movieId).filter((id): id is string => id != null));
  for (const movie of db.select().from(movies).where(eq(movies.libraryId, libraryId)).all()) {
    if (!movieIds.has(movie.id)) db.delete(movies).where(eq(movies.id, movie.id)).run();
  }
  const episodeIds = new Set(files.map((file) => file.episodeId).filter((id): id is string => id != null));
  for (const show of db.select().from(series).where(eq(series.libraryId, libraryId)).all()) {
    const showEpisodes = db.select().from(episodes).where(eq(episodes.seriesId, show.id)).all();
    if (!showEpisodes.some((episode) => episodeIds.has(episode.id))) {
      db.delete(episodes).where(eq(episodes.seriesId, show.id)).run();
      db.delete(seasons).where(eq(seasons.seriesId, show.id)).run();
      db.delete(series).where(eq(series.id, show.id)).run();
      continue;
    }
    for (const episode of showEpisodes) {
      if (!episodeIds.has(episode.id)) db.delete(episodes).where(eq(episodes.id, episode.id)).run();
    }
  }
  const trackIds = new Set(files.map((file) => file.trackId).filter((id): id is string => id != null));
  for (const album of db.select().from(albums).where(eq(albums.libraryId, libraryId)).all()) {
    const albumTracks = db.select().from(tracks).where(eq(tracks.albumId, album.id)).all();
    if (!albumTracks.some((track) => trackIds.has(track.id))) {
      db.delete(tracks).where(eq(tracks.albumId, album.id)).run();
      db.delete(albums).where(eq(albums.id, album.id)).run();
      continue;
    }
    for (const track of albumTracks) {
      if (!trackIds.has(track.id)) db.delete(tracks).where(eq(tracks.id, track.id)).run();
    }
  }
  const artistIds = new Set(db.select().from(albums).where(eq(albums.libraryId, libraryId)).all().map((album) => album.artistId));
  for (const artist of db.select().from(artists).where(eq(artists.libraryId, libraryId)).all()) {
    if (!artistIds.has(artist.id)) db.delete(artists).where(eq(artists.id, artist.id)).run();
  }
}
