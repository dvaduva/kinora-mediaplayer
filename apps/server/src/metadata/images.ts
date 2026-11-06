import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths.js";

const SAFE_PATH = /^\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DOWNLOAD_CONCURRENCY = 6;

export function isTmdbImagePath(value: string) {
  return SAFE_PATH.test(value);
}

export function cachedImageFile(size: string, tmdbPath: string) {
  if (!isTmdbImagePath(tmdbPath)) throw new Error("bad image path");
  if (!/^[a-z0-9]+$/.test(size)) throw new Error("bad image size");
  return path.join(dataDir, "cache", "images", size, tmdbPath.slice(1));
}

export function tmdbCdnUrl(size: string, tmdbPath: string) {
  return `https://image.tmdb.org/t/p/${size}${tmdbPath}`;
}

export async function downloadTmdbImage(size: string, tmdbPath: string) {
  if (!tmdbPath || !isTmdbImagePath(tmdbPath)) return;
  const destination = cachedImageFile(size, tmdbPath);
  if (fs.existsSync(destination)) return;
  const response = await fetch(tmdbCdnUrl(size, tmdbPath));
  if (!response.ok) return;
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}

async function mapPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run());
  await Promise.all(workers);
}

export async function downloadTmdbImages(items: { size: string; path: string | null | undefined }[]) {
  const pending = items.filter((item): item is { size: string; path: string } => Boolean(item.path));
  await mapPool(pending, DOWNLOAD_CONCURRENCY, async (item) => {
    try {
      await downloadTmdbImage(item.size, item.path);
    } catch {
      // A missing poster should not fail the match.
    }
  });
}
