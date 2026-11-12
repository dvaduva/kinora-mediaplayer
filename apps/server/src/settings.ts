import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { movies, profiles, series, settings } from "./db/schema.js";
import { isMetadataLanguage, type MetadataLanguage } from "./metadata/language.js";
import { DEFAULT_CACHE_GB } from "./playback/cache.js";

export const PROFILE_ID = "home";

export function seedProfile() {
  const existing = db.select().from(profiles).where(eq(profiles.id, PROFILE_ID)).get();
  if (!existing) {
    db.insert(profiles).values({ id: PROFILE_ID, name: "Acasă", subtitleLanguage: "ro" }).run();
  }
}

export function getSetting(key: string): string | null {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  if (value == null || value === "") {
    db.delete(settings).where(eq(settings.key, key)).run();
    return;
  }
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getProfile() {
  seedProfile();
  const profile = db.select().from(profiles).where(eq(profiles.id, PROFILE_ID)).get();
  if (!profile) throw new Error("Profile missing");
  return profile;
}

export function tokenHint(token: string | null) {
  if (!token) return null;
  if (token.length <= 4) return "••••";
  return `••••${token.slice(-4)}`;
}

export { isLocalHost } from "./security.js";

/** Disk budget for converted HLS copies, in GB. */
export function transcodeCacheGb() {
  const value = Number(getSetting("transcodeCacheGb"));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CACHE_GB;
}

/** Language of TMDB titles, overviews, genres and preferred artwork. */
export function metadataLanguage(): MetadataLanguage {
  const value = getSetting("metadataLanguage");
  return isMetadataLanguage(value) ? value : "en";
}

/**
 * New installs default to English. Libraries matched before the setting existed were fetched in Romanian,
 * so they keep Romanian until the owner changes it.
 */
export function seedMetadataLanguage() {
  if (getSetting("metadataLanguage") != null) return;
  const matched =
    db.select({ id: movies.id }).from(movies).where(eq(movies.matched, true)).limit(1).get() ??
    db.select({ id: series.id }).from(series).where(eq(series.matched, true)).limit(1).get();
  setSetting("metadataLanguage", matched ? "ro" : "en");
}
