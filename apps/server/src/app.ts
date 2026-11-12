import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { ExternalTitleDetail, LibraryType, PersonDetail } from "@kinora/shared";
import { isSubtitleColor, isSubtitleSize, SUBTITLE_DELAY_LIMIT } from "@kinora/shared";
import {
  albumDetail,
  decorateSimilar,
  artistDetail,
  homeView,
  identifyQueue,
  isWatchStatus,
  libraryViews,
  listAlbums,
  listArtists,
  listMovies,
  listSeries,
  localTitleId,
  movieDetail,
  personCredits,
  playbackView,
  resolveMediaPath,
  resolveSubtitlePath,
  saveProgress,
  searchLibrary,
  seriesDetail,
  setMovieWatchStatus,
} from "./catalog.js";
import { db } from "./db/index.js";
import { albums, mediaFiles, tracks } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { cachedImageFile, downloadTmdbImage, isTmdbImagePath, tmdbCdnUrl } from "./metadata/images.js";
import { searchReleases } from "./metadata/musicbrainz.js";
import { albumClips } from "./metadata/clips.js";
import { fetchMovie, fetchPerson, fetchSeries, searchMovieCandidates, searchSeriesCandidates, TmdbNotConfiguredError, TmdbUnreachableError } from "./metadata/tmdb.js";
import { repoRoot } from "./paths.js";
import { EditError, movieArtwork, movieRatings, movieReviewList, saveOwnReview, updateMovie } from "./movieExtras.js";
import { contentTypeFor } from "./playback/plan.js";
import { materializeSubtitle, subtitleChunk } from "./playback/materialize.js";
import { beginTranscode, describePlayback, refreshTools } from "./playback/session.js";
import { registerLiveTv } from "./livetv/routes.js";
import { gigabytes } from "./playback/cache.js";
import {
  hasOtherTranscode,
  lookupTranscode,
  playlistForClient,
  pruneTranscodes,
  setTranscodeCacheLimit,
  transcodeCacheUsage,
} from "./playback/transcode.js";
import { tools } from "./process.js";
import { browse, BrowseError } from "./browse.js";
import { createLibrary, deleteLibrary, matchAlbum, matchMovie, matchSeries, refreshAllMetadata, startScan } from "./scan.js";
import { getProfile, getSetting, isLocalHost, metadataLanguage, PROFILE_ID, setSetting, tokenHint, transcodeCacheGb } from "./settings.js";
import { isMetadataLanguage } from "./metadata/language.js";
import { profiles } from "./db/schema.js";
import { isAllowedHost, isAllowedOrigin, trustedOrigins } from "./security.js";

function sameToken(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function waitForFile(file: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (fs.statSync(file).size > 0) return true;
    } catch {
      // The encoder publishes the file when the segment is complete.
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Start point of a midway Live TV session from the URL; null when it is not a whole second inside the file. */
function sessionStart(raw: string, fileId: string) {
  if (!/^\d{1,6}$/.test(raw)) return null;
  const start = Number(raw);
  const duration = db.select({ duration: mediaFiles.duration }).from(mediaFiles).where(eq(mediaFiles.id, fileId)).get()?.duration;
  if (start <= 0 || duration == null || start >= duration) return null;
  return start;
}

export async function buildApp(options: { bindHost?: string; logger?: boolean } = {}) {
  const bindHost = options.bindHost ?? "127.0.0.1";
  const app = Fastify({ logger: options.logger ?? true });
  const trusted = trustedOrigins();
  // Same-origin requests need no CORS; only the dev server and configured origins get CORS headers.
  await app.register(cors, { origin: trusted, credentials: true });
  await app.register(cookie);

  // YouTube embeds need a Referer; same-origin / no-referrer policies trigger error 153.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    return payload;
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!isAllowedHost(request.headers.host, bindHost)) return reply.code(421).send({ error: "bad_host" });
    if (!request.url.startsWith("/api")) return;
    if (!isAllowedOrigin(request.headers.origin, request.headers.host, trusted)) {
      return reply.code(403).send({ error: "bad_origin" });
    }
    const open = request.url.startsWith("/api/health") || request.url.startsWith("/api/setup") || request.url.startsWith("/api/session");
    if (open) return;
    const configured = getSetting("accessToken");
    if (!configured) return;
    const header = request.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
    const cookieToken = request.cookies.kinora_token ?? "";
    if (sameToken(bearer, configured) || sameToken(cookieToken, configured)) return;
    return reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/api/health", async () => {
    refreshTools();
    return { ok: true, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe };
  });

  app.get("/api/setup", async () => {
    refreshTools();
    return {
      tokenRequired: Boolean(getSetting("accessToken")),
      ffmpeg: tools.ffmpeg,
      ffprobe: tools.ffprobe,
    };
  });

  app.post("/api/session", async (request, reply) => {
    const configured = getSetting("accessToken");
    const token = String(asRecord(request.body).token ?? "");
    if (!configured) return { ok: true };
    if (!sameToken(token, configured)) return reply.code(401).send({ error: "unauthorized" });
    reply.setCookie("kinora_token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400 });
    return { ok: true };
  });

  app.get("/api/settings", async () => {
    refreshTools();
    return {
      tmdbConfigured: Boolean(getSetting("tmdbReadToken")),
      tmdbHint: tokenHint(getSetting("tmdbReadToken")),
      omdbConfigured: Boolean(getSetting("omdbApiKey")),
      omdbHint: tokenHint(getSetting("omdbApiKey")),
      metadataLanguage: metadataLanguage(),
      bindHost: getSetting("bindHost") ?? "127.0.0.1",
      tokenRequired: Boolean(getSetting("accessToken")),
      ffmpeg: tools.ffmpeg,
      ffprobe: tools.ffprobe,
      subtitleLanguage: getProfile().subtitleLanguage,
      subtitleStyle: { size: getProfile().subtitleSize, color: getProfile().subtitleColor },
      transcodeCacheGb: transcodeCacheGb(),
      transcodeCacheBytes: transcodeCacheUsage(),
    };
  });

  app.post("/api/cache/transcode/clear", async () => {
    const result = pruneTranscodes(0);
    return { ok: true, removed: result.removed, freed: result.freed, transcodeCacheBytes: transcodeCacheUsage() };
  });

  app.put("/api/settings", async (request, reply) => {
    const body = asRecord(request.body);
    if (typeof body.tmdbReadToken === "string" && body.tmdbReadToken.trim()) setSetting("tmdbReadToken", body.tmdbReadToken.trim());
    if (typeof body.omdbApiKey === "string" && body.omdbApiKey.trim()) {
      const key = body.omdbApiKey.trim();
      if (!/^[A-Za-z0-9]{4,64}$/.test(key)) return reply.code(400).send({ error: "bad_omdb_key" });
      setSetting("omdbApiKey", key);
    }
    if (body.clearOmdbApiKey === true) setSetting("omdbApiKey", null);
    if (body.metadataLanguage !== undefined) {
      if (!isMetadataLanguage(body.metadataLanguage)) return reply.code(400).send({ error: "bad_metadata_language" });
      if (body.metadataLanguage !== metadataLanguage()) {
        setSetting("metadataLanguage", body.metadataLanguage);
        refreshAllMetadata();
      }
    }
    if (typeof body.bindHost === "string" && body.bindHost.trim()) {
      const host = body.bindHost.trim();
      const token = typeof body.accessToken === "string" && body.accessToken.trim() ? body.accessToken.trim() : getSetting("accessToken");
      if (!isLocalHost(host) && !token) return reply.code(400).send({ error: "token_required" });
      setSetting("bindHost", host);
    }
    if (body.transcodeCacheGb !== undefined) {
      const gb = typeof body.transcodeCacheGb === "number" ? body.transcodeCacheGb : Number(body.transcodeCacheGb);
      if (!Number.isFinite(gb) || gb < 1 || gb > 100_000) return reply.code(400).send({ error: "bad_cache_limit" });
      setSetting("transcodeCacheGb", String(gb));
      setTranscodeCacheLimit(gigabytes(gb));
      pruneTranscodes();
    }
    if (body.clearAccessToken === true) setSetting("accessToken", null);
    if (typeof body.accessToken === "string" && body.accessToken.trim()) {
      const token = body.accessToken.trim();
      setSetting("accessToken", token);
      reply.setCookie("kinora_token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400 });
    }
    return { ok: true, restartRequired: typeof body.bindHost === "string" };
  });

  app.put("/api/profile", async (request, reply) => {
    const body = asRecord(request.body);
    const change: Partial<typeof profiles.$inferInsert> = {};
    if (body.subtitleLanguage !== undefined) {
      const language = String(body.subtitleLanguage);
      if (!/^(off|[a-z]{2})$/.test(language)) return reply.code(400).send({ error: "bad_language" });
      change.subtitleLanguage = language;
    }
    if (body.subtitleSize !== undefined) {
      if (!isSubtitleSize(body.subtitleSize)) return reply.code(400).send({ error: "bad_subtitle_size" });
      change.subtitleSize = body.subtitleSize;
    }
    if (body.subtitleColor !== undefined) {
      if (!isSubtitleColor(body.subtitleColor)) return reply.code(400).send({ error: "bad_subtitle_color" });
      change.subtitleColor = body.subtitleColor.toLowerCase();
    }
    getProfile();
    if (Object.keys(change).length > 0) db.update(profiles).set(change).where(eq(profiles.id, PROFILE_ID)).run();
    return { ok: true };
  });

  app.get("/api/libraries", async () => libraryViews());

  app.get("/api/folders", async (request, reply) => {
    try {
      return browse(String((request.query as { path?: string }).path ?? ""));
    } catch (error) {
      if (error instanceof BrowseError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  app.post("/api/libraries", async (request, reply) => {
    const body = asRecord(request.body);
    const type = body.type;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const roots = Array.isArray(body.roots) ? body.roots.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    if (!name || (type !== "movie" && type !== "series" && type !== "music") || roots.length === 0) {
      return reply.code(400).send({ error: "bad_library" });
    }
    const id = createLibrary({ name, type: type as LibraryType, roots });
    return reply.code(201).send({ id });
  });

  app.delete("/api/libraries/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const exists = libraryViews().some((library) => library.id === id);
    if (!exists) return reply.code(404).send({ error: "not_found" });
    deleteLibrary(id);
    return reply.code(204).send();
  });

  app.post("/api/libraries/:id/scan", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!libraryViews().some((library) => library.id === id)) return reply.code(404).send({ error: "not_found" });
    const started = startScan(id);
    if (!started) return reply.code(409).send({ error: "scan_in_progress" });
    return { started: true };
  });

  app.get("/api/home", async () => homeView());
  app.get("/api/movies", async () => listMovies());
  app.get("/api/movies/:id", async (request, reply) => movieDetail((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" }));
  app.put("/api/movies/:id/status", async (request, reply) => {
    const status = asRecord(request.body).status;
    // null clears the manual mark and returns to the status derived from playback.
    if (status !== null && !isWatchStatus(status)) return reply.code(400).send({ error: "bad_status" });
    if (!setMovieWatchStatus((request.params as { id: string }).id, status)) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });
  app.put("/api/movies/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      if (!updateMovie(id, asRecord(request.body))) return reply.code(404).send({ error: "not_found" });
    } catch (error) {
      if (error instanceof EditError) return reply.code(400).send({ error: error.message });
      throw error;
    }
    return movieDetail(id) ?? reply.code(404).send({ error: "not_found" });
  });
  app.get("/api/movies/:id/ratings", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const refresh = (request.query as { refresh?: string }).refresh === "1";
    return (await movieRatings(id, refresh)) ?? reply.code(404).send({ error: "not_found" });
  });
  app.get("/api/movies/:id/reviews", async (request, reply) => {
    return (await movieReviewList((request.params as { id: string }).id)) ?? reply.code(404).send({ error: "not_found" });
  });
  app.put("/api/movies/:id/review", async (request, reply) => {
    const saved = saveOwnReview((request.params as { id: string }).id, asRecord(request.body));
    if (saved === "invalid") return reply.code(400).send({ error: "bad_review" });
    return saved ?? reply.code(404).send({ error: "not_found" });
  });
  app.get("/api/movies/:id/artwork", async (request, reply) => {
    try {
      return (await movieArtwork((request.params as { id: string }).id)) ?? reply.code(404).send({ error: "not_found" });
    } catch (error) {
      if (error instanceof TmdbNotConfiguredError) return reply.code(400).send({ error: "tmdb_not_configured" });
      if (error instanceof TmdbUnreachableError) return reply.code(503).send({ error: "tmdb_unreachable" });
      request.log.warn(error);
      return reply.code(502).send({ error: "tmdb_failed" });
    }
  });
  app.get("/api/series", async () => listSeries());
  app.get("/api/series/:id", async (request, reply) => seriesDetail((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" }));
  app.get("/api/people/:id", async (request, reply) => {
    const tmdbId = Number((request.params as { id: string }).id);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return reply.code(400).send({ error: "bad_id" });
    const { credits, fallback } = personCredits(tmdbId);
    let profile: Awaited<ReturnType<typeof fetchPerson>> = null;
    try {
      profile = await fetchPerson(tmdbId);
    } catch (error) {
      // Without TMDB the page still lists the library titles from stored cast data.
      if (!(error instanceof TmdbNotConfiguredError || error instanceof TmdbUnreachableError)) request.log.warn(error);
    }
    if (!profile && !fallback) return reply.code(404).send({ error: "not_found" });
    const detail: PersonDetail = {
      tmdbId,
      name: profile?.name ?? fallback?.name ?? "",
      biography: profile?.biography ?? null,
      birthday: profile?.birthday ?? null,
      deathday: profile?.deathday ?? null,
      placeOfBirth: profile?.placeOfBirth ?? null,
      profilePath: profile?.profilePath ?? fallback?.profilePath ?? null,
      knownFor: profile?.knownFor ?? null,
      imdbId: profile?.imdbId ?? null,
      profileLoaded: profile != null,
      credits,
    };
    return detail;
  });
  app.get("/api/tmdb/:kind/:id", async (request, reply) => {
    const params = request.params as { kind: string; id: string };
    const tmdbId = Number(params.id);
    if ((params.kind !== "movie" && params.kind !== "tv") || !Number.isInteger(tmdbId) || tmdbId <= 0) return reply.code(400).send({ error: "bad_id" });
    const kind = params.kind;
    try {
      const localId = localTitleId(kind, tmdbId);
      if (kind === "movie") {
        const movie = await fetchMovie(tmdbId);
        const detail: ExternalTitleDetail = {
          ...movie,
          mediaType: "movie",
          localId,
          creators: [],
          similar: decorateSimilar(movie.similar),
        };
        return detail;
      }
      const show = await fetchSeries(tmdbId);
      const detail: ExternalTitleDetail = {
        ...show,
        mediaType: "tv",
        localId,
        tagline: null,
        releaseDate: null,
        runtime: null,
        directors: [],
        writers: [],
        stills: [],
        similar: decorateSimilar(show.similar),
      };
      return detail;
    } catch (error) {
      if (error instanceof TmdbNotConfiguredError) return reply.code(400).send({ error: "tmdb_not_configured" });
      if (error instanceof TmdbUnreachableError) return reply.code(503).send({ error: "tmdb_unreachable" });
      if (error instanceof Error && error.message === "tmdb_404") return reply.code(404).send({ error: "not_found" });
      request.log.warn(error);
      return reply.code(502).send({ error: "tmdb_failed" });
    }
  });
  app.get("/api/albums", async () => listAlbums());
  app.get("/api/albums/:id", async (request, reply) => (await albumDetail((request.params as { id: string }).id)) ?? reply.code(404).send({ error: "not_found" }));
  app.get("/api/albums/:id/clips", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const album = db.select().from(albums).where(eq(albums.id, id)).get();
    if (!album) return reply.code(404).send({ error: "not_found" });
    const local = db.select().from(tracks).where(eq(tracks.albumId, id)).all();
    try {
      return { clips: await albumClips(id, album.mbid, local) };
    } catch (error) {
      request.log.warn(error);
      return reply.code(502).send({ error: "musicbrainz_failed" });
    }
  });
  app.get("/api/artists", async () => listArtists());
  app.get("/api/artists/:id", async (request, reply) => artistDetail((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" }));
  app.get("/api/search", async (request) => searchLibrary(String((request.query as { q?: string }).q ?? "")));
  app.get("/api/identify", async () => identifyQueue());

  app.post("/api/tmdb/search", async (request, reply) => {
    const body = asRecord(request.body);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const yearRaw = body.year;
    const year =
      typeof yearRaw === "number" && Number.isFinite(yearRaw)
        ? yearRaw
        : typeof yearRaw === "string" && /^\d{4}$/.test(yearRaw.trim())
          ? Number(yearRaw.trim())
          : null;
    if (!query) return reply.code(400).send({ error: "bad_query" });
    try {
      const results = body.kind === "series" ? await searchSeriesCandidates(query, year) : await searchMovieCandidates(query, year);
      return { results };
    } catch (error) {
      if (error instanceof TmdbNotConfiguredError) return reply.code(400).send({ error: "tmdb_not_configured" });
      if (error instanceof TmdbUnreachableError) return reply.code(503).send({ error: "tmdb_unreachable" });
      request.log.error(error);
      return reply.code(502).send({ error: "tmdb_failed" });
    }
  });

  app.post("/api/musicbrainz/search", async (request, reply) => {
    const body = asRecord(request.body);
    const artist = typeof body.artist === "string" ? body.artist.trim() : "";
    const album = typeof body.album === "string" ? body.album.trim() : "";
    const track = typeof body.track === "string" ? body.track.trim() : "";
    if (!artist || (!album && !track)) return reply.code(400).send({ error: "bad_query" });
    try {
      return { results: await searchReleases(artist, album, track || null) };
    } catch {
      return reply.code(502).send({ error: "musicbrainz_failed" });
    }
  });

  app.post("/api/movies/:id/match", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const tmdbId = asRecord(request.body).tmdbId;
    if (typeof tmdbId !== "number") return reply.code(400).send({ error: "bad_match" });
    try {
      await matchMovie(id, tmdbId);
    } catch (error) {
      if (error instanceof TmdbNotConfiguredError) return reply.code(400).send({ error: "tmdb_not_configured" });
      if (error instanceof TmdbUnreachableError) return reply.code(503).send({ error: "tmdb_unreachable" });
      request.log.error(error);
      return reply.code(502).send({ error: "tmdb_failed" });
    }
    return movieDetail(id) ?? reply.code(404).send({ error: "not_found" });
  });

  app.post("/api/series/:id/match", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const tmdbId = asRecord(request.body).tmdbId;
    if (typeof tmdbId !== "number") return reply.code(400).send({ error: "bad_match" });
    try {
      await matchSeries(id, tmdbId);
    } catch (error) {
      if (error instanceof TmdbNotConfiguredError) return reply.code(400).send({ error: "tmdb_not_configured" });
      if (error instanceof TmdbUnreachableError) return reply.code(503).send({ error: "tmdb_unreachable" });
      request.log.error(error);
      return reply.code(502).send({ error: "tmdb_failed" });
    }
    return seriesDetail(id) ?? reply.code(404).send({ error: "not_found" });
  });

  app.post("/api/albums/:id/match", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const mbid = asRecord(request.body).mbid;
    if (typeof mbid !== "string" || !mbid.trim()) return reply.code(400).send({ error: "bad_match" });
    try {
      await matchAlbum(id, mbid.trim());
    } catch {
      return reply.code(502).send({ error: "musicbrainz_failed" });
    }
    return (await albumDetail(id)) ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/playback/:fileId", async (request, reply) => {
    const fileId = (request.params as { fileId: string }).fileId;
    const described = describePlayback(fileId);
    if (!described) return reply.code(404).send({ error: "not_found" });
    if (described.view.plan.available && described.view.plan.mode !== "direct") {
      void beginTranscode(fileId, true).catch(() => undefined);
    }
    return described.view;
  });

  app.post("/api/playback/progress", async (request, reply) => {
    const body = asRecord(request.body);
    const fileId = typeof body.fileId === "string" ? body.fileId : "";
    const position = typeof body.position === "number" ? body.position : Number.NaN;
    const duration = typeof body.duration === "number" ? body.duration : Number.NaN;
    const subtitleChoice = typeof body.subtitleChoice === "string" ? body.subtitleChoice : null;
    const subtitleDelay = typeof body.subtitleDelay === "number" ? body.subtitleDelay : undefined;
    if (!fileId || !Number.isFinite(position) || !Number.isFinite(duration)) return reply.code(400).send({ error: "bad_progress" });
    if (subtitleDelay !== undefined && !(Math.abs(subtitleDelay) <= SUBTITLE_DELAY_LIMIT)) return reply.code(400).send({ error: "bad_subtitle_delay" });
    if (!saveProgress({ fileId, position, duration, subtitleChoice, subtitleDelay })) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  /** Transcode status; `start` > 0 is a separate Live TV session that begins midway. */
  async function streamStatus(fileId: string, start: number) {
    const cached = lookupTranscode(fileId, true, start);
    if (cached) return cached.status;
    const described = describePlayback(fileId);
    if (!described) return null;
    if (!described.view.plan.available) {
      return {
        state: "error",
        seconds: 0,
        duration: described.view.duration,
        progress: null,
        playlist: false,
        error: described.view.plan.reasonCode,
      };
    }
    if (described.view.plan.mode === "direct") {
      return {
        state: "ready",
        seconds: described.view.duration ?? 0,
        duration: described.view.duration,
        progress: 1,
        playlist: false,
        error: null,
      };
    }
    const opened = await beginTranscode(fileId, false, start);
    return opened?.status ?? null;
  }

  /** The session a playlist or segment request belongs to; a request from a player that was switched away does not restart it. */
  async function openSession(fileId: string, start: number) {
    return lookupTranscode(fileId, false, start) ?? (hasOtherTranscode(fileId, start) ? null : await beginTranscode(fileId, false, start));
  }

  async function sendPlaylist(reply: FastifyReply, fileId: string, start: number) {
    const opened = await openSession(fileId, start);
    if (!opened) return reply.code(404).send({ error: "not_found" });
    const playlist = path.join(opened.dir, "index.m3u8");
    if (!(await waitForFile(playlist))) return reply.code(404).send({ error: "not_ready" });
    const contents = fs.readFileSync(playlist, "utf8");
    reply.type("application/vnd.apple.mpegurl");
    reply.header("Cache-Control", "no-cache");
    return reply.send(playlistForClient(contents));
  }

  async function sendSegment(request: FastifyRequest, reply: FastifyReply, fileId: string, start: number, segment: string) {
    if (!/^seg\d+\.ts$/.test(segment)) return reply.code(404).send({ error: "not_found" });
    const opened = await openSession(fileId, start);
    if (!opened) return reply.code(404).send({ error: "not_found" });
    const file = path.join(opened.dir, segment);
    if (!(await waitForFile(file, 1000))) return reply.code(404).send({ error: "not_ready" });
    const bytes = fs.readFileSync(file);
    const range = typeof request.headers.range === "string" ? request.headers.range : undefined;
    let status = 200;
    let first = 0;
    let last = bytes.length - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return reply.code(416).send();
      first = match[1] ? Number(match[1]) : 0;
      last = match[2] ? Number(match[2]) : bytes.length - 1;
      if (!Number.isFinite(first) || !Number.isFinite(last) || first > last || first >= bytes.length) {
        reply.header("Content-Range", `bytes */${bytes.length}`);
        return reply.code(416).send();
      }
      last = Math.min(last, bytes.length - 1);
      status = 206;
    }
    const slice = bytes.subarray(first, last + 1);
    const headers: Record<string, string | number> = {
      "Content-Type": "video/mp2t",
      "Content-Length": slice.length,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
    };
    if (status === 206) headers["Content-Range"] = `bytes ${first}-${last}/${bytes.length}`;
    reply.hijack();
    reply.raw.socket?.resume();
    reply.raw.writeHead(status, headers);
    reply.raw.end(slice);
  }

  app.get("/api/stream/:fileId/status", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const status = await streamStatus((request.params as { fileId: string }).fileId, 0);
    return status ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/stream/:fileId/index.m3u8", async (request, reply) => sendPlaylist(reply, (request.params as { fileId: string }).fileId, 0));

  app.get("/api/stream/:fileId/:segment", async (request, reply) => {
    const params = request.params as { fileId: string; segment: string };
    return sendSegment(request, reply, params.fileId, 0, params.segment);
  });

  app.get("/api/stream/:fileId/at/:start/status", async (request, reply) => {
    const params = request.params as { fileId: string; start: string };
    const start = sessionStart(params.start, params.fileId);
    if (start == null) return reply.code(404).send({ error: "not_found" });
    reply.header("Cache-Control", "no-store");
    const status = await streamStatus(params.fileId, start);
    return status ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/stream/:fileId/at/:start/index.m3u8", async (request, reply) => {
    const params = request.params as { fileId: string; start: string };
    const start = sessionStart(params.start, params.fileId);
    if (start == null) return reply.code(404).send({ error: "not_found" });
    return sendPlaylist(reply, params.fileId, start);
  });

  app.get("/api/stream/:fileId/at/:start/:segment", async (request, reply) => {
    const params = request.params as { fileId: string; start: string; segment: string };
    const start = sessionStart(params.start, params.fileId);
    if (start == null) return reply.code(404).send({ error: "not_found" });
    return sendSegment(request, reply, params.fileId, start, params.segment);
  });

  app.get("/api/stream/:fileId", async (request, reply) => {
    const fileId = (request.params as { fileId: string }).fileId;
    const row = db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get();
    if (!row) return reply.code(404).send({ error: "not_found" });
    const filePath = resolveMediaPath(row);
    if (!filePath) return reply.code(404).send({ error: "not_found" });
    refreshTools();
    const view = playbackView(fileId);
    if (!view?.plan.available) return reply.code(415).send({ error: view?.plan.reasonCode ?? "missing" });
    if (view.plan.mode !== "direct") return reply.code(415).send({ error: view.plan.reasonCode });
    const stat = fs.statSync(filePath);
    const type = contentTypeFor(row.container, row.trackId ? "audio" : "video");
    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", type);
    reply.header("Cache-Control", "private, max-age=0");
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return reply.code(416).send();
      const start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
        reply.header("Content-Range", `bytes */${stat.size}`);
        return reply.code(416).send();
      }
      end = Math.min(end, stat.size - 1);
      reply.code(206);
      reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      reply.header("Content-Length", String(end - start + 1));
      return reply.send(fs.createReadStream(filePath, { start, end }));
    }
    reply.header("Content-Length", String(stat.size));
    return reply.send(fs.createReadStream(filePath));
  });

  app.get("/api/subtitles/:fileId/:subtitleId/chunk/:index", async (request, reply) => {
    const params = request.params as { fileId: string; subtitleId: string; index: string };
    const index = Number(params.index);
    if (!Number.isInteger(index) || index < 0) return reply.code(400).send({ error: "bad_index" });
    const resolved = resolveSubtitlePath(params.fileId, params.subtitleId);
    if (!resolved) return reply.code(404).send({ error: "not_found" });
    try {
      // The player drops requests for windows it has seeked away from; stop reading those.
      const aborted = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) aborted.abort();
      });
      return await subtitleChunk(resolved.asset, resolved.file, index, aborted.signal);
    } catch (error) {
      const code = error instanceof Error ? error.message : "extract_failed";
      return reply.code(code === "bitmap" || code === "needs_ffmpeg" || code === "not_embedded" ? 415 : code === "aborted" ? 499 : 500).send({ error: code });
    }
  });

  app.get("/api/subtitles/:fileId/:subtitleId", async (request, reply) => {
    const params = request.params as { fileId: string; subtitleId: string };
    const resolved = resolveSubtitlePath(params.fileId, params.subtitleId);
    if (!resolved) return reply.code(404).send({ error: "not_found" });
    try {
      const vtt = await materializeSubtitle(resolved.asset, resolved.file.path);
      reply.type("text/vtt; charset=utf-8");
      return reply.send(fs.createReadStream(vtt));
    } catch (error) {
      const code = error instanceof Error ? error.message : "extract_failed";
      return reply.code(code === "bitmap" || code === "needs_ffmpeg" || code === "chunked" ? 415 : 500).send({ error: code });
    }
  });

  app.get("/api/images", async (request, reply) => {
    const query = request.query as { path?: string; size?: string };
    const imagePath = query.path ?? "";
    const size = query.size && /^[a-z0-9]+$/.test(query.size) ? query.size : "w342";
    if (!isTmdbImagePath(imagePath)) return reply.code(400).send({ error: "bad_path" });
    const file = cachedImageFile(size, imagePath);
    if (fs.existsSync(file)) {
      reply.type(imagePath.endsWith(".png") ? "image/png" : "image/jpeg");
      reply.header("Cache-Control", "private, max-age=86400");
      return reply.send(fs.createReadStream(file));
    }
    // Serve from TMDB immediately; warm the local cache without blocking the poster.
    void downloadTmdbImage(size, imagePath).catch(() => undefined);
    return reply.redirect(tmdbCdnUrl(size, imagePath));
  });

  app.get("/api/covers/:name", async (request, reply) => {
    const name = (request.params as { name: string }).name;
    if (!/^[\w.-]+$/.test(name)) return reply.code(400).send({ error: "bad_path" });
    const file = path.join(repoRoot, "data", "cache", "covers", name);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: "not_found" });
    reply.type(name.endsWith(".png") ? "image/png" : "image/jpeg");
    return reply.send(fs.createReadStream(file));
  });

  registerLiveTv(app);

  const webDist = path.join(repoRoot, "apps", "web", "dist");
  const tvDist = path.join(repoRoot, "apps", "tv", "dist");
  const hasWeb = fs.existsSync(webDist);
  const hasTv = fs.existsSync(tvDist);

  if (hasTv) {
    await app.register(fastifyStatic, {
      root: tvDist,
      prefix: "/tv/",
      decorateReply: !hasWeb,
    });
  }
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      decorateReply: true,
    });
  }
  if (hasTv) {
    app.get("/tv", async (_request, reply) => reply.redirect("/tv/"));
  }
  if (hasWeb || hasTv) {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) return reply.code(404).send({ error: "not_found" });
      const pathname = request.url.split("?")[0] ?? "";
      if (pathname === "/tv" || pathname.startsWith("/tv/")) {
        if (!hasTv) return reply.code(404).send({ error: "not_found" });
        return reply.sendFile("index.html", tvDist);
      }
      if (!hasWeb) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html", webDist);
    });
  }

  return app;
}
