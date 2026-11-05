import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths.js";

const SAFE_PATH = /^\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isTmdbImagePath(value: string) {
  return SAFE_PATH.test(value);
}

export function cachedImageFile(size: string, tmdbPath: string) {
  if (!isTmdbImagePath(tmdbPath)) throw new Error("bad image path");
  if (!/^[a-z0-9]+$/.test(size)) throw new Error("bad image size");
  return path.join(dataDir, "cache", "images", size, tmdbPath.slice(1));
}

export async function downloadTmdbImage(size: string, tmdbPath: string) {
  if (!tmdbPath || !isTmdbImagePath(tmdbPath)) return;
  const destination = cachedImageFile(size, tmdbPath);
  if (fs.existsSync(destination)) return;
  const response = await fetch(`https://image.tmdb.org/t/p/${size}${tmdbPath}`);
  if (!response.ok) return;
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
}

export async function downloadTmdbImages(items: { size: string; path: string | null | undefined }[]) {
  for (const item of items) {
    if (!item.path) continue;
    try {
      await downloadTmdbImage(item.size, item.path);
    } catch {
      // A missing poster should not fail the match.
    }
  }
}
