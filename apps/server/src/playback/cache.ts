import fs from "node:fs";
import path from "node:path";

export interface CacheEntry {
  key: string;
  dir: string;
  bytes: number;
  lastUsed: number;
}

export interface EvictionPolicy {
  maxBytes: number;
  maxAgeMs: number;
  now: number;
  /** Entries in use by a running encoder or an open session are never removed. */
  protectedKeys: Set<string>;
}

export const DEFAULT_CACHE_GB = 30;
export const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const USED_MARKER = "used";

export function gigabytes(value: number) {
  return Math.round(value * 1024 ** 3);
}

function directorySize(dir: string) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      try {
        total += fs.statSync(path.join(dir, entry.name)).size;
      } catch {
        // A segment can disappear while the encoder rewrites it.
      }
    }
  } catch {
    return 0;
  }
  return total;
}

function lastUsedOf(dir: string) {
  for (const candidate of [path.join(dir, USED_MARKER), dir]) {
    try {
      return fs.statSync(candidate).mtimeMs;
    } catch {
      // Fall back to the directory itself.
    }
  }
  return 0;
}

export function listCache(root: string): CacheEntry[] {
  let names: string[];
  try {
    names = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return names.map((key) => {
    const dir = path.join(root, key);
    return { key, dir, bytes: directorySize(dir), lastUsed: lastUsedOf(dir) };
  });
}

/** Removes entries older than maxAge, then the least recently used ones until the total fits maxBytes. */
export function pickEvictions(entries: CacheEntry[], policy: EvictionPolicy): CacheEntry[] {
  const evict: CacheEntry[] = [];
  const kept: CacheEntry[] = [];
  for (const entry of entries) {
    if (!policy.protectedKeys.has(entry.key) && policy.now - entry.lastUsed > policy.maxAgeMs) evict.push(entry);
    else kept.push(entry);
  }
  let total = kept.reduce((sum, entry) => sum + entry.bytes, 0);
  const oldestFirst = kept.filter((entry) => !policy.protectedKeys.has(entry.key)).sort((a, b) => a.lastUsed - b.lastUsed);
  for (const entry of oldestFirst) {
    if (total <= policy.maxBytes) break;
    evict.push(entry);
    total -= entry.bytes;
  }
  return evict;
}

export function pruneCache(root: string, policy: Omit<EvictionPolicy, "now"> & { now?: number }) {
  const entries = listCache(root);
  const evicted = pickEvictions(entries, { ...policy, now: policy.now ?? Date.now() });
  let freed = 0;
  for (const entry of evicted) {
    try {
      fs.rmSync(entry.dir, { recursive: true, force: true });
      freed += entry.bytes;
    } catch {
      // Windows keeps files locked while a player still reads them; the next pass retries.
    }
  }
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0) - freed;
  return { removed: evicted.length, freed, total };
}

export function markUsed(dir: string) {
  const marker = path.join(dir, USED_MARKER);
  const now = new Date();
  try {
    fs.utimesSync(marker, now, now);
  } catch {
    try {
      fs.writeFileSync(marker, "");
    } catch {
      // The directory may not exist yet.
    }
  }
}
