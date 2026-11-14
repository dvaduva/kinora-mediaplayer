import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrationsFolder, runMigrations } from "./migrate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const legacySchema = fs.readFileSync(path.join(here, "fixtures", "legacy-schema.sql"), "utf8");

function foreignKeys(sqlite: Database.Database, table: string) {
  return (sqlite.pragma(`foreign_key_list(${table})`) as { table: string; from: string; on_delete: string }[]).map(
    (row) => `${row.from}->${row.table}:${row.on_delete}`,
  );
}

function seed(sqlite: Database.Database) {
  const now = Date.now();
  sqlite.prepare("INSERT INTO libraries VALUES ('lib', 'Filme', 'movie', '[]', ?)").run(now);
  sqlite.prepare("INSERT INTO profiles (id, name, subtitle_language) VALUES ('home', 'Acasă', 'ro')").run();
  sqlite.prepare("INSERT INTO movies (id, library_id, group_key, title, added_at) VALUES ('m1', 'lib', 'g', 'Film', ?)").run(now);
  sqlite
    .prepare("INSERT INTO media_files (id, library_id, movie_id, path, size, mtime, updated_at) VALUES ('f1', 'lib', 'm1', 'C:/f.mkv', 1, 1, ?)")
    .run(now);
  sqlite.prepare("INSERT INTO subtitle_assets (id, file_id, origin) VALUES ('s1', 'f1', 'external')").run();
  sqlite.prepare("INSERT INTO progress (profile_id, file_id, position, duration, watched, subtitle_choice, updated_at) VALUES ('home', 'f1', 10, 100, 0, NULL, ?)").run(now);
}

test("creates the full schema with foreign keys on a new database", () => {
  const sqlite = new Database(":memory:");
  const result = runMigrations(sqlite);
  assert.equal(result.adopted, false);
  assert.equal(sqlite.pragma("foreign_keys", { simple: true }), 1);
  assert.ok(foreignKeys(sqlite, "media_files").includes("movie_id->movies:SET NULL"));
  seed(sqlite);
  sqlite.prepare("INSERT INTO movie_status VALUES ('home', 'm1', 'watched', 0)").run();
  sqlite.prepare("DELETE FROM libraries WHERE id = 'lib'").run();
  for (const table of ["movies", "media_files", "subtitle_assets", "progress", "movie_status"]) {
    assert.equal((sqlite.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c, 0, table);
  }
});

test("upgrades a database from before migrations without losing rows", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(legacySchema);
  seed(sqlite);
  // Left behind by an old bug: a subtitle and a progress row for a file that no longer exists.
  sqlite.prepare("INSERT INTO subtitle_assets (id, file_id, origin) VALUES ('ghost', 'gone', 'external')").run();
  sqlite.prepare("INSERT INTO progress VALUES ('home', 'gone', 1, 2, 0, NULL, 0)").run();

  const result = runMigrations(sqlite);
  assert.equal(result.adopted, true);
  assert.deepEqual(foreignKeys(sqlite, "subtitle_assets"), ["file_id->media_files:CASCADE"]);
  assert.deepEqual(
    sqlite.prepare("SELECT id FROM subtitle_assets").all(),
    [{ id: "s1" }],
  );
  assert.equal((sqlite.prepare("SELECT count(*) AS c FROM progress").get() as { c: number }).c, 1);
  assert.equal((sqlite.prepare("SELECT movie_id FROM media_files WHERE id = 'f1'").get() as { movie_id: string }).movie_id, "m1");
  assert.equal(sqlite.pragma("foreign_keys", { simple: true }), 1);
  assert.deepEqual(sqlite.prepare("SELECT subtitle_size, subtitle_color FROM profiles").get(), { subtitle_size: 100, subtitle_color: "#ffffff" });
  assert.deepEqual(sqlite.prepare("SELECT subtitle_delay FROM progress WHERE file_id = 'f1'").get(), { subtitle_delay: 0 });

  // Running again is a no-op.
  assert.equal(runMigrations(sqlite).adopted, false);
  assert.equal((sqlite.prepare("SELECT count(*) AS c FROM __drizzle_migrations").get() as { c: number }).c, readMigrationFiles({ migrationsFolder }).length);
});

test("a movie leaving the library leaves its lists, and a deleted list keeps its movies", () => {
  const sqlite = new Database(":memory:");
  runMigrations(sqlite);
  seed(sqlite);
  sqlite.prepare("INSERT INTO movies (id, library_id, group_key, title, added_at) VALUES ('m2', 'lib', 'g2', 'Alt film', 0)").run();
  sqlite.prepare("INSERT INTO movie_lists VALUES ('kids', 'home', 'Filme copii', 0, 0)").run();
  sqlite.prepare("INSERT INTO movie_lists VALUES ('drama', 'home', 'Drame', 0, 0)").run();
  sqlite.prepare("INSERT INTO movie_list_items VALUES ('kids', 'm1', 0), ('kids', 'm2', 0), ('drama', 'm2', 0)").run();
  const count = (sql: string) => (sqlite.prepare(sql).get() as { c: number }).c;

  sqlite.prepare("DELETE FROM movies WHERE id = 'm1'").run();
  assert.equal(count("SELECT count(*) AS c FROM movie_list_items WHERE list_id = 'kids'"), 1);

  sqlite.prepare("DELETE FROM movie_lists WHERE id = 'kids'").run();
  assert.equal(count("SELECT count(*) AS c FROM movie_list_items"), 1, "only the Drama membership is left");
  assert.equal(count("SELECT count(*) AS c FROM movies WHERE id = 'm2'"), 1, "the movie stays in the library");
});
