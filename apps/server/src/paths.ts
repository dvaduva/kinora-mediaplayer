import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, "../../..");
export const dataDir = path.join(repoRoot, "data");
export const dbPath = path.join(dataDir, "kinora.db");

export function ensureDataDirs() {
  for (const dir of [
    dataDir,
    path.join(dataDir, "cache", "tmdb"),
    path.join(dataDir, "cache", "images"),
    path.join(dataDir, "cache", "subtitles"),
    path.join(dataDir, "cache", "covers"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function pathKey(file: string) {
  const resolved = path.resolve(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isInsideRoot(file: string, roots: string[]) {
  let realFile: string;
  try {
    realFile = fs.realpathSync(file);
  } catch {
    return false;
  }
  return roots.some((root) => {
    let realRoot = root;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      return false;
    }
    const relative = path.relative(realRoot, realFile);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}
