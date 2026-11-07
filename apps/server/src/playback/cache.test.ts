import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listCache, markUsed, pickEvictions, pruneCache, type CacheEntry } from "./cache.js";

const DAY = 24 * 60 * 60 * 1000;
const now = 100 * DAY;

function entry(key: string, bytes: number, daysAgo: number): CacheEntry {
  return { key, dir: `/cache/${key}`, bytes, lastUsed: now - daysAgo * DAY };
}

test("keeps everything while under the size limit and age", () => {
  const entries = [entry("a", 10, 1), entry("b", 10, 2)];
  assert.deepEqual(pickEvictions(entries, { maxBytes: 100, maxAgeMs: 30 * DAY, now, protectedKeys: new Set() }), []);
});

test("evicts the least recently used conversions until the total fits", () => {
  const entries = [entry("new", 40, 1), entry("old", 40, 9), entry("mid", 40, 5)];
  const evicted = pickEvictions(entries, { maxBytes: 50, maxAgeMs: 30 * DAY, now, protectedKeys: new Set() });
  assert.deepEqual(
    evicted.map((item) => item.key),
    ["old", "mid"],
  );
});

test("drops conversions older than the age limit even under the size limit", () => {
  const entries = [entry("stale", 1, 45), entry("fresh", 1, 2)];
  const evicted = pickEvictions(entries, { maxBytes: 1000, maxAgeMs: 30 * DAY, now, protectedKeys: new Set() });
  assert.deepEqual(
    evicted.map((item) => item.key),
    ["stale"],
  );
});

test("never evicts the conversion that is playing or encoding", () => {
  const entries = [entry("playing", 80, 60), entry("other", 30, 1)];
  const evicted = pickEvictions(entries, { maxBytes: 0, maxAgeMs: 30 * DAY, now, protectedKeys: new Set(["playing"]) });
  assert.deepEqual(
    evicted.map((item) => item.key),
    ["other"],
  );
});

test("prunes real directories by their last use", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kinora-cache-"));
  try {
    for (const [key, size, daysAgo] of [
      ["old", 600, 3],
      ["recent", 600, 0],
    ] as const) {
      const dir = path.join(root, key);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "seg00000.ts"), Buffer.alloc(size));
      markUsed(dir);
      const when = new Date(Date.now() - daysAgo * DAY);
      fs.utimesSync(path.join(dir, "used"), when, when);
    }
    assert.equal(listCache(root).length, 2);
    const result = pruneCache(root, { maxBytes: 1000, maxAgeMs: 30 * DAY, protectedKeys: new Set() });
    assert.equal(result.removed, 1);
    assert.equal(result.total, 600);
    assert.deepEqual(
      listCache(root).map((item) => item.key),
      ["recent"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
