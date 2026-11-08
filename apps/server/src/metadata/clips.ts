import fs from "node:fs";
import path from "node:path";
import type { TrackClip } from "@kinora/shared";
import { dataDir } from "../paths.js";
import { mbGet } from "./musicbrainz.js";

/** How long a lookup stays fresh; MusicBrainz gains links over time. */
const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** Upper bound on extra video-recording lookups per album (each costs ~1.1 s of rate limit). */
const MAX_VIDEO_LOOKUPS = 12;

interface Relation {
  type?: string;
  direction?: string;
  "target-type"?: string;
  url?: { resource?: string };
  recording?: { id?: string; video?: boolean };
}

interface ReleaseTrack {
  position?: number;
  title?: string;
  recording?: { id?: string; title?: string; relations?: Relation[] };
}

export interface ReleaseBody {
  media?: { position?: number; tracks?: ReleaseTrack[] }[];
}

export interface LocalTrack {
  id: string;
  title: string;
  trackNumber: number | null;
  discNumber: number | null;
}

/** A track on the MusicBrainz release, with what it links to. */
export interface RemoteTrack {
  disc: number;
  position: number;
  title: string;
  videoRecordings: string[];
  youtube: string | null;
}

export function youtubeKey(resource: string | undefined): string | null {
  if (!resource) return null;
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  let key: string | null = null;
  if (host === "youtube.com" || host === "music.youtube.com" || host === "m.youtube.com") {
    key = url.pathname === "/watch" ? url.searchParams.get("v") : (/^\/(?:embed|v|shorts)\/([^/]+)/.exec(url.pathname)?.[1] ?? null);
  } else if (host === "youtu.be") {
    key = url.pathname.slice(1).split("/")[0] ?? null;
  }
  return key && /^[\w-]{11}$/.test(key) ? key : null;
}

function firstYoutube(relations: Relation[] | undefined) {
  for (const relation of relations ?? []) {
    if (relation["target-type"] !== "url") continue;
    const key = youtubeKey(relation.url?.resource);
    if (key) return key;
  }
  return null;
}

export function readRelease(body: ReleaseBody): RemoteTrack[] {
  const result: RemoteTrack[] = [];
  for (const medium of body.media ?? []) {
    for (const track of medium.tracks ?? []) {
      const relations = track.recording?.relations ?? [];
      result.push({
        disc: medium.position ?? 1,
        position: track.position ?? 0,
        title: track.title ?? track.recording?.title ?? "",
        videoRecordings: relations
          .filter((relation) => relation.type === "music video" && relation.direction === "forward" && relation.recording?.id)
          .map((relation) => relation.recording?.id ?? ""),
        youtube: firstYoutube(relations),
      });
    }
  }
  return result;
}

export function titleKey(title: string) {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Pairs local tracks with release tracks: by title first, then by disc and
 * position when that disc has the same number of tracks on both sides.
 */
export function pairTracks(local: LocalTrack[], remote: RemoteTrack[]) {
  const pairs = new Map<string, RemoteTrack>();
  const byTitle = new Map<string, RemoteTrack>();
  for (const track of remote) {
    const key = titleKey(track.title);
    if (key && !byTitle.has(key)) byTitle.set(key, track);
  }
  const countOn = (tracks: { disc: number }[], disc: number) => tracks.filter((track) => track.disc === disc).length;
  const localDiscs = local.map((track) => ({ disc: track.discNumber ?? 1 }));
  for (const track of local) {
    const byName = byTitle.get(titleKey(track.title));
    if (byName) {
      pairs.set(track.id, byName);
      continue;
    }
    const disc = track.discNumber ?? 1;
    if (track.trackNumber == null || countOn(localDiscs, disc) !== countOn(remote, disc)) continue;
    const byPosition = remote.find((candidate) => candidate.disc === disc && candidate.position === track.trackNumber);
    if (byPosition) pairs.set(track.id, byPosition);
  }
  return pairs;
}

interface CacheFile {
  mbid: string;
  fetchedAt: number;
  tracks: RemoteTrack[];
  /** video recording id -> YouTube key (null when it has none). */
  videos: Record<string, string | null>;
}

const clipsDir = path.join(dataDir, "cache", "clips");
const inflight = new Map<string, Promise<CacheFile>>();

function readCache(albumId: string, mbid: string): CacheFile | null {
  try {
    const cached = JSON.parse(fs.readFileSync(path.join(clipsDir, `${albumId}.json`), "utf8")) as CacheFile;
    if (cached.mbid !== mbid || Date.now() - cached.fetchedAt > FRESH_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

async function fetchRelease(albumId: string, mbid: string): Promise<CacheFile> {
  const body = (await mbGet(
    `https://musicbrainz.org/ws/2/release/${encodeURIComponent(mbid)}?inc=recordings+recording-level-rels+recording-rels+url-rels&fmt=json`,
  )) as ReleaseBody;
  const tracks = readRelease(body);
  const videos: Record<string, string | null> = {};
  const wanted = [...new Set(tracks.flatMap((track) => track.videoRecordings))].slice(0, MAX_VIDEO_LOOKUPS);
  for (const id of wanted) {
    try {
      const recording = (await mbGet(`https://musicbrainz.org/ws/2/recording/${encodeURIComponent(id)}?inc=url-rels&fmt=json`)) as {
        relations?: Relation[];
      };
      videos[id] = firstYoutube(recording.relations);
    } catch {
      videos[id] = null;
    }
  }
  const cached: CacheFile = { mbid, fetchedAt: Date.now(), tracks, videos };
  fs.mkdirSync(clipsDir, { recursive: true });
  fs.writeFileSync(path.join(clipsDir, `${albumId}.json`), JSON.stringify(cached));
  return cached;
}

export function clipsFrom(cached: Pick<CacheFile, "tracks" | "videos">, local: LocalTrack[]) {
  const result: Record<string, TrackClip> = {};
  for (const [trackId, remote] of pairTracks(local, cached.tracks)) {
    const video = remote.videoRecordings.map((id) => cached.videos[id]).find((key) => key);
    if (video) result[trackId] = { key: video, kind: "video" };
    else if (remote.youtube) result[trackId] = { key: remote.youtube, kind: "audio" };
  }
  return result;
}

/** YouTube clips for an album's tracks, from MusicBrainz links. Empty when the album has no release id. */
export async function albumClips(albumId: string, mbid: string | null, local: LocalTrack[]) {
  if (!mbid) return {};
  let cached = readCache(albumId, mbid);
  if (!cached) {
    let pending = inflight.get(albumId);
    if (!pending) {
      pending = fetchRelease(albumId, mbid).finally(() => inflight.delete(albumId));
      inflight.set(albumId, pending);
    }
    cached = await pending;
  }
  return clipsFrom(cached, local);
}
