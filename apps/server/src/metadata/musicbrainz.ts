import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { MusicCandidate } from "@kinora/shared";
import { db } from "../db/index.js";
import { albums } from "../db/schema.js";
import { dataDir } from "../paths.js";
import { createGate } from "./gate.js";

const wait = createGate(1100);
const USER_AGENT = "Kinora/0.1 (http://127.0.0.1:3001)";

interface ReleaseHit {
  id?: string;
  title?: string;
  date?: string;
  status?: string;
  "artist-credit"?: { name?: string }[];
}

interface NamedCount {
  name?: string;
  count?: number;
}

interface MbRelation {
  type?: string;
  url?: { resource?: string };
}

export interface ReleaseMeta {
  overview: string | null;
  genres: string[];
  styles: string[];
  recordLabel: string | null;
  rating: number | null;
  year: number | null;
}

export async function mbGet(url: string) {
  await wait();
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, accept: "application/json" } });
  if (!response.ok) throw new Error(`musicbrainz_${response.status}`);
  return (await response.json()) as unknown;
}

function quote(value: string) {
  return value.replace(/"/g, "");
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function rankedNames(items: NamedCount[] | undefined, limit = 8) {
  return (items ?? [])
    .filter((item): item is NamedCount & { name: string } => Boolean(item.name))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .map((item) => titleCase(item.name))
    .filter((name, index, list) => list.findIndex((entry) => entry.toLowerCase() === name.toLowerCase()) === index)
    .slice(0, limit);
}

function wikipediaPageTitle(url: string) {
  try {
    const parsed = new URL(url);
    if (!/\.wikipedia\.org$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/wiki\/(.+)$/);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1].replace(/_/g, " "));
  } catch {
    return null;
  }
}

async function wikipediaExtract(relations: MbRelation[] | undefined) {
  const links = (relations ?? [])
    .filter((relation) => relation.type === "wikipedia" && relation.url?.resource)
    .map((relation) => relation.url!.resource!);
  const preferred = links.find((link) => /\/\/en\.wikipedia\.org\//i.test(link)) ?? links[0];
  if (!preferred) return null;
  const title = wikipediaPageTitle(preferred);
  if (!title) return null;
  const host = (() => {
    try {
      return new URL(preferred).hostname;
    } catch {
      return "en.wikipedia.org";
    }
  })();
  const response = await fetch(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
    headers: { "User-Agent": USER_AGENT, accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { extract?: string; type?: string };
  if (body.type === "disambiguation") return null;
  const extract = body.extract?.trim();
  return extract || null;
}

/**
 * Finds MusicBrainz releases. Album+artist is the usual path; adding a track title
 * (`recording:…`) often ranks the right release higher when the album name is vague.
 */
export async function searchReleases(artist: string, album: string, track?: string | null): Promise<MusicCandidate[]> {
  const artistQ = quote(artist.trim());
  const albumTitle = album.trim();
  const trackTitle = track?.trim() || "";
  const queries: string[] = [];
  if (albumTitle) queries.push(`release:"${quote(albumTitle)}" AND artist:"${artistQ}"`);
  if (trackTitle && trackTitle.toLowerCase() !== albumTitle.toLowerCase()) {
    queries.push(`recording:"${quote(trackTitle)}" AND artist:"${artistQ}"`);
  } else if (!albumTitle && trackTitle) {
    queries.push(`recording:"${quote(trackTitle)}" AND artist:"${artistQ}"`);
  }
  if (queries.length === 0) return [];

  const seen = new Set<string>();
  const results: MusicCandidate[] = [];
  for (const query of queries) {
    const url = `https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
    const body = (await mbGet(url)) as { releases?: ReleaseHit[] };
    for (const release of body.releases ?? []) {
      if (!release.id || !release.title || seen.has(release.id)) continue;
      seen.add(release.id);
      results.push({
        mbid: release.id,
        title: release.title,
        artist: release["artist-credit"]?.[0]?.name ?? artist,
        year: release.date && release.date.length >= 4 ? Number(release.date.slice(0, 4)) : null,
      });
      if (results.length >= 8) return results;
    }
  }
  return results;
}

export async function downloadReleaseCover(mbid: string, filenameStem: string) {
  await wait();
  const response = await fetch(`https://coverartarchive.org/release/${mbid}`, {
    headers: { "User-Agent": USER_AGENT, accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { images?: { front?: boolean; image?: string }[] };
  const image = body.images?.find((item) => item.front && item.image) ?? body.images?.find((item) => item.image);
  if (!image?.image) return null;
  await wait();
  const file = await fetch(image.image, { headers: { "User-Agent": USER_AGENT } });
  if (!file.ok) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = `${filenameStem}.jpg`;
  const destination = path.join(dataDir, "cache", "covers", filename);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  return `cover:${filename}`;
}

/** Genres, styles, label, rating, and a Wikipedia overview for a MusicBrainz release. */
export async function fetchReleaseMeta(mbid: string): Promise<ReleaseMeta> {
  const release = (await mbGet(`https://musicbrainz.org/ws/2/release/${mbid}?inc=labels+release-groups&fmt=json`)) as {
    date?: string;
    "label-info"?: { label?: { name?: string } }[];
    "release-group"?: { id?: string };
  };
  const recordLabel = release["label-info"]?.map((entry) => entry.label?.name).find((name): name is string => Boolean(name)) ?? null;
  const year = release.date && release.date.length >= 4 ? Number(release.date.slice(0, 4)) : null;
  const releaseGroupId = release["release-group"]?.id;
  if (!releaseGroupId) {
    return { overview: null, genres: [], styles: [], recordLabel, rating: null, year };
  }

  const group = (await mbGet(
    `https://musicbrainz.org/ws/2/release-group/${releaseGroupId}?inc=genres+tags+ratings+url-rels&fmt=json`,
  )) as {
    genres?: NamedCount[];
    tags?: NamedCount[];
    rating?: { value?: number };
    relations?: MbRelation[];
  };

  const genres = rankedNames(group.genres);
  const genreKeys = new Set(genres.map((name) => name.toLowerCase()));
  const styles = rankedNames(group.tags).filter((name) => !genreKeys.has(name.toLowerCase()));
  const rating = typeof group.rating?.value === "number" && group.rating.value > 0 ? group.rating.value : null;
  const overview = await wikipediaExtract(group.relations);
  return { overview, genres, styles, recordLabel, rating, year };
}

/** Fill album dossier fields from MusicBrainz once per mbid match. */
export async function enrichAlbumMeta(albumId: string) {
  const album = db.select().from(albums).where(eq(albums.id, albumId)).get();
  if (!album?.mbid || album.metaFetchedAt != null) return;
  const now = Date.now();
  try {
    const meta = await fetchReleaseMeta(album.mbid);
    db.update(albums)
      .set({
        overview: meta.overview,
        genresJson: JSON.stringify(meta.genres),
        stylesJson: JSON.stringify(meta.styles),
        recordLabel: meta.recordLabel,
        rating: meta.rating,
        year: album.year ?? meta.year,
        metaFetchedAt: now,
      })
      .where(eq(albums.id, albumId))
      .run();
  } catch {
    db.update(albums).set({ metaFetchedAt: now }).where(eq(albums.id, albumId)).run();
  }
}
