import fs from "node:fs";
import path from "node:path";
import type { MusicCandidate } from "@kinora/shared";
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

export async function mbGet(url: string) {
  await wait();
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, accept: "application/json" } });
  if (!response.ok) throw new Error(`musicbrainz_${response.status}`);
  return (await response.json()) as unknown;
}

function quote(value: string) {
  return value.replace(/"/g, "");
}

export async function searchReleases(artist: string, album: string): Promise<MusicCandidate[]> {
  const query = `release:"${quote(album)}" AND artist:"${quote(artist)}"`;
  const url = `https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(query)}&fmt=json&limit=5`;
  const body = (await mbGet(url)) as { releases?: ReleaseHit[] };
  return (body.releases ?? [])
    .filter((release) => release.id && release.title)
    .map((release) => ({
      mbid: release.id ?? "",
      title: release.title ?? album,
      artist: release["artist-credit"]?.[0]?.name ?? artist,
      year: release.date && release.date.length >= 4 ? Number(release.date.slice(0, 4)) : null,
    }));
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
