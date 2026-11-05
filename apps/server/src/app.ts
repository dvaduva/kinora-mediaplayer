import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { LibraryType } from "@kinora/shared";
import {
  albumDetail,
  artistDetail,
  homeView,
  identifyQueue,
  libraryViews,
  listAlbums,
  listArtists,
  listMovies,
  listSeries,
  movieDetail,
  playbackView,
  resolveMediaPath,
  resolveSubtitlePath,
  saveProgress,
  searchLibrary,
  seriesDetail,
} from "./catalog.js";
import { db } from "./db/index.js";
import { mediaFiles } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { cachedImageFile, downloadTmdbImage, isTmdbImagePath } from "./metadata/images.js";
import { searchReleases } from "./metadata/musicbrainz.js";
import { searchMovieCandidates, searchSeriesCandidates, TmdbNotConfiguredError } from "./metadata/tmdb.js";
import { repoRoot } from "./paths.js";
import { contentTypeFor } from "./playback/plan.js";
import { materializeSubtitle } from "./playback/materialize.js";
import { ensureTranscode, hasOtherTranscode, lookupTranscode, playlistForClient } from "./playback/transcode.js";
import { detectTools, tools } from "./process.js";
import { createLibrary, deleteLibrary, matchAlbum, matchMovie, matchSeries, startScan } from "./scan.js";
import { getProfile, getSetting, isLocalHost, PROFILE_ID, setSetting, tokenHint } from "./settings.js";
import { profiles } from "./db/schema.js";

function sameToken(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function refreshTools() {
  if (!tools.ffmpeg || !tools.ffprobe) detectTools();
}

function describePlayback(fileId: string) {
  refreshTools();
  const row = db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get();
  if (!row) return null;
  const filePath = resolveMediaPath(row);
  if (!filePath) return null;
  const view = playbackView(fileId);
  if (!view) return null;
  return { row, filePath, view };
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

async function beginTranscode(fileId: string, restartError: boolean) {
  const described = describePlayback(fileId);
  if (!described || !described.view.plan.available || described.view.plan.mode === "direct") return null;
  const stat = fs.statSync(described.filePath);
  const opened = await ensureTranscode(
    {
      fileId,
      sourcePath: described.filePath,
      size: stat.size,
      mtime: Math.round(stat.mtimeMs),
      duration: described.row.duration,
      copyAudio: described.view.plan.mode === "remux",
    },
    restartError,
  );
  return opened;
}

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api")) return;
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

  app.get("/api/health", async () => ({ ok: true, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe }));

  app.get("/api/setup", async () => ({
    tokenRequired: Boolean(getSetting("accessToken")),
    ffmpeg: tools.ffmpeg,
    ffprobe: tools.ffprobe,
  }));

  app.post("/api/session", async (request, reply) => {
    const configured = getSetting("accessToken");
    const token = String(asRecord(request.body).token ?? "");
    if (!configured) return { ok: true };
    if (!sameToken(token, configured)) return reply.code(401).send({ error: "unauthorized" });
    reply.setCookie("kinora_token", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400 });
    return { ok: true };
  });

  app.get("/api/settings", async () => ({
    tmdbConfigured: Boolean(getSetting("tmdbReadToken")),
    tmdbHint: tokenHint(getSetting("tmdbReadToken")),
    bindHost: getSetting("bindHost") ?? "127.0.0.1",
    tokenRequired: Boolean(getSetting("accessToken")),
    ffmpeg: tools.ffmpeg,
    ffprobe: tools.ffprobe,
    subtitleLanguage: getProfile().subtitleLanguage,
  }));

  app.put("/api/settings", async (request, reply) => {
    const body = asRecord(request.body);
    if (typeof body.tmdbReadToken === "string" && body.tmdbReadToken.trim()) setSetting("tmdbReadToken", body.tmdbReadToken.trim());
    if (typeof body.bindHost === "string" && body.bindHost.trim()) {
      const host = body.bindHost.trim();
      const token = typeof body.accessToken === "string" && body.accessToken.trim() ? body.accessToken.trim() : getSetting("accessToken");
      if (!isLocalHost(host) && !token) return reply.code(400).send({ error: "token_required" });
      setSetting("bindHost", host);
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
    const language = String(asRecord(request.body).subtitleLanguage ?? "");
    if (!/^(off|[a-z]{2})$/.test(language)) return reply.code(400).send({ error: "bad_language" });
    db.update(profiles).set({ subtitleLanguage: language }).where(eq(profiles.id, PROFILE_ID)).run();
    return { ok: true };
  });

  app.get("/api/libraries", async () => libraryViews());

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
  app.get("/api/series", async () => listSeries());
  app.get("/api/series/:id", async (request, reply) => seriesDetail((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" }));
  app.get("/api/albums", async () => listAlbums());
  app.get("/api/albums/:id", async (request, reply) => albumDetail((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" }));
  app.get("/api/artists", async () => listArtists());
  app.get("/api/artists/:id", async (request, reply) => artistDetail((request.params as { id: string }).id) ?? reply.code(404).send({ error: "not_found" }));
  app.get("/api/search", async (request) => searchLibrary(String((request.query as { q?: string }).q ?? "")));
  app.get("/api/identify", async () => identifyQueue());

  app.post("/api/tmdb/search", async (request, reply) => {
    const body = asRecord(request.body);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const year = typeof body.year === "number" ? body.year : null;
    if (!query) return reply.code(400).send({ error: "bad_query" });
    try {
      const results = body.kind === "series" ? await searchSeriesCandidates(query, year) : await searchMovieCandidates(query, year);
      return { results };
    } catch (error) {
      if (error instanceof TmdbNotConfiguredError) return reply.code(400).send({ error: "tmdb_not_configured" });
      return reply.code(502).send({ error: "tmdb_failed" });
    }
  });

  app.post("/api/musicbrainz/search", async (request, reply) => {
    const body = asRecord(request.body);
    const artist = typeof body.artist === "string" ? body.artist.trim() : "";
    const album = typeof body.album === "string" ? body.album.trim() : "";
    if (!artist || !album) return reply.code(400).send({ error: "bad_query" });
    try {
      return { results: await searchReleases(artist, album) };
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
    return albumDetail(id) ?? reply.code(404).send({ error: "not_found" });
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
    if (!fileId || !Number.isFinite(position) || !Number.isFinite(duration)) return reply.code(400).send({ error: "bad_progress" });
    if (!saveProgress({ fileId, position, duration, subtitleChoice })) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.get("/api/stream/:fileId/status", async (request, reply) => {
    const fileId = (request.params as { fileId: string }).fileId;
    reply.header("Cache-Control", "no-store");
    const cached = lookupTranscode(fileId);
    if (cached) return cached.status;
    const described = describePlayback(fileId);
    if (!described) return reply.code(404).send({ error: "not_found" });
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
    const opened = await beginTranscode(fileId, false);
    if (!opened) return reply.code(404).send({ error: "not_found" });
    return opened.status;
  });

  app.get("/api/stream/:fileId/index.m3u8", async (request, reply) => {
    const fileId = (request.params as { fileId: string }).fileId;
    const opened = lookupTranscode(fileId, false) ?? (hasOtherTranscode(fileId) ? null : await beginTranscode(fileId, false));
    if (!opened) return reply.code(404).send({ error: "not_found" });
    const playlist = path.join(opened.dir, "index.m3u8");
    if (!(await waitForFile(playlist))) return reply.code(404).send({ error: "not_ready" });
    const contents = fs.readFileSync(playlist, "utf8");
    reply.type("application/vnd.apple.mpegurl");
    reply.header("Cache-Control", "no-cache");
    return reply.send(playlistForClient(contents));
  });

  app.get("/api/stream/:fileId/:segment", async (request, reply) => {
    const params = request.params as { fileId: string; segment: string };
    if (!/^seg\d+\.ts$/.test(params.segment)) return reply.code(404).send({ error: "not_found" });
    const opened = lookupTranscode(params.fileId, false) ?? (hasOtherTranscode(params.fileId) ? null : await beginTranscode(params.fileId, false));
    if (!opened) return reply.code(404).send({ error: "not_found" });
    const file = path.join(opened.dir, params.segment);
    if (!(await waitForFile(file, 1000))) return reply.code(404).send({ error: "not_ready" });
    const bytes = fs.readFileSync(file);
    const range = typeof request.headers.range === "string" ? request.headers.range : undefined;
    let status = 200;
    let start = 0;
    let end = bytes.length - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return reply.code(416).send();
      start = match[1] ? Number(match[1]) : 0;
      end = match[2] ? Number(match[2]) : bytes.length - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= bytes.length) {
        reply.header("Content-Range", `bytes */${bytes.length}`);
        return reply.code(416).send();
      }
      end = Math.min(end, bytes.length - 1);
      status = 206;
    }
    const slice = bytes.subarray(start, end + 1);
    const headers: Record<string, string | number> = {
      "Content-Type": "video/mp2t",
      "Content-Length": slice.length,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
    };
    if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${bytes.length}`;
    reply.hijack();
    reply.raw.socket?.resume();
    reply.raw.writeHead(status, headers);
    reply.raw.end(slice);
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
      return reply.code(code === "bitmap" || code === "needs_ffmpeg" ? 415 : 500).send({ error: code });
    }
  });

  app.get("/api/images", async (request, reply) => {
    const query = request.query as { path?: string; size?: string };
    const imagePath = query.path ?? "";
    const size = query.size && /^[a-z0-9]+$/.test(query.size) ? query.size : "w342";
    if (!isTmdbImagePath(imagePath)) return reply.code(400).send({ error: "bad_path" });
    try {
      await downloadTmdbImage(size, imagePath);
    } catch {
      // The cached file is checked below.
    }
    const file = cachedImageFile(size, imagePath);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: "not_found" });
    reply.type(imagePath.endsWith(".png") ? "image/png" : "image/jpeg");
    reply.header("Cache-Control", "private, max-age=86400");
    return reply.send(fs.createReadStream(file));
  });

  app.get("/api/covers/:name", async (request, reply) => {
    const name = (request.params as { name: string }).name;
    if (!/^[\w.-]+$/.test(name)) return reply.code(400).send({ error: "bad_path" });
    const file = path.join(repoRoot, "data", "cache", "covers", name);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: "not_found" });
    reply.type(name.endsWith(".png") ? "image/png" : "image/jpeg");
    return reply.send(fs.createReadStream(file));
  });

  const dist = path.join(repoRoot, "apps", "web", "dist");
  if (fs.existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
