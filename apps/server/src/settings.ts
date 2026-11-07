import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { profiles, settings } from "./db/schema.js";

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
