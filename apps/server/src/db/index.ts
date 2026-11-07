import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { runMigrations } from "./migrate.js";
import { dbPath, ensureDataDirs } from "../paths.js";

ensureDataDirs();

export const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
// Schema changes live in apps/server/drizzle; this also turns foreign key enforcement on.
runMigrations(sqlite);

export const db = drizzle(sqlite, { schema });

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
