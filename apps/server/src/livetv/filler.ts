import fs from "node:fs";
import path from "node:path";
import type { LiveFiller } from "@kinora/shared";
import { isNotNull } from "drizzle-orm";
import { db, parseJson } from "../db/index.js";
import { movies, series } from "../db/schema.js";
import { dataDir } from "../paths.js";
import { pickFillerVideos, type FillerVideo, type TitleTrailer } from "./fillerPick.js";

/** Pools are rebuilt at most this often; a filler only needs a rough list. */
const POOL_TTL_MS = 10 * 60_000;

const clipsDir = path.join(dataDir, "cache", "clips");
let trailerPool: { at: number; videos: TitleTrailer[] } | null = null;
let clipPool: { at: number; videos: FillerVideo[] } | null = null;

function isYoutubeKey(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{11}$/.test(value);
}

/** Trailers of the library's movies and series (from TMDB, stored with each title). */
function trailers(now: number) {
  if (trailerPool && now - trailerPool.at < POOL_TTL_MS) return trailerPool.videos;
  const videos: TitleTrailer[] = [];
  const rows = [
    ...db.select({ id: movies.id, title: movies.title, trailer: movies.trailerJson }).from(movies).where(isNotNull(movies.trailerJson)).all(),
    ...db.select({ id: series.id, title: series.title, trailer: series.trailerJson }).from(series).where(isNotNull(series.trailerJson)).all(),
  ];
  for (const row of rows) {
    const key = parseJson<{ key?: unknown } | null>(row.trailer, null)?.key;
    if (isYoutubeKey(key)) videos.push({ key, title: row.title, kind: "trailer", titleId: row.id });
  }
  trailerPool = { at: now, videos };
  return videos;
}

/** Music videos found for the library's albums (the clip lookups already cached from MusicBrainz). */
function clips(now: number) {
  if (clipPool && now - clipPool.at < POOL_TTL_MS) return clipPool.videos;
  const videos: FillerVideo[] = [];
  const seen = new Set<string>();
  let names: string[] = [];
  try {
    names = fs.readdirSync(clipsDir).filter((name) => name.endsWith(".json"));
  } catch {
    // No album has been looked up yet.
  }
  for (const name of names) {
    try {
      const cached = JSON.parse(fs.readFileSync(path.join(clipsDir, name), "utf8")) as {
        tracks?: { title?: string; videoRecordings?: string[] }[];
        videos?: Record<string, string | null>;
      };
      for (const track of cached.tracks ?? []) {
        const key = (track.videoRecordings ?? []).map((id) => cached.videos?.[id]).find(isYoutubeKey);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        videos.push({ key, title: track.title ?? "", kind: "clip" });
      }
    } catch {
      // A damaged cache file is skipped.
    }
  }
  clipPool = { at: now, videos };
  return videos;
}

export function fillerFor(input: { kind: LiveFiller["kind"]; ownTitles: Set<string>; music: boolean; seed: number; seconds: number; now?: number }): LiveFiller {
  if (input.kind === "upnext") return { kind: "upnext", videos: [] };
  const now = input.now ?? Date.now();
  return {
    kind: "media",
    videos: pickFillerVideos({ trailers: trailers(now), clips: clips(now), ownTitles: input.ownTitles, music: input.music, seed: input.seed, seconds: input.seconds }),
  };
}
