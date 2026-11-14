import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  MOVIE_LIST_NAME_MAX,
  MOVIE_LIST_PREVIEW,
  type MovieListDetail,
  type MovieListRef,
  type MovieListSummary,
} from "@kinora/shared";
import { db } from "./db/index.js";
import { movieListItems, movieLists, movies } from "./db/schema.js";
import { movieSummary, presence, watchContext } from "./catalog.js";
import { getProfile, PROFILE_ID } from "./settings.js";

export class ListError extends Error {}

type MovieRow = typeof movies.$inferSelect;

function nameKey(name: string) {
  return name.toLocaleLowerCase("ro");
}

/** A trimmed name, or a ListError: empty, too long, or already used by another list (case does not matter). */
function checkedName(value: unknown, exceptId?: string) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new ListError("bad_name");
  if (name.length > MOVIE_LIST_NAME_MAX) throw new ListError("name_too_long");
  const key = nameKey(name);
  const taken = ownLists().some((list) => list.id !== exceptId && nameKey(list.name) === key);
  if (taken) throw new ListError("name_taken");
  return name;
}

function ownLists() {
  return db.select().from(movieLists).where(eq(movieLists.profileId, PROFILE_ID)).all();
}

function ownList(id: string) {
  return db.select().from(movieLists).where(and(eq(movieLists.id, id), eq(movieLists.profileId, PROFILE_ID))).get() ?? null;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "ro", { sensitivity: "base", numeric: true });

const byTitle = (a: MovieRow, b: MovieRow) =>
  (a.sortTitle ?? a.title).localeCompare(b.sortTitle ?? b.title, "ro", { sensitivity: "base", numeric: true });

/** List id → its movies that are on disk, sorted by title. */
function presentMembers(listIds: string[]) {
  const members = new Map<string, MovieRow[]>(listIds.map((id) => [id, []]));
  if (listIds.length === 0) return members;
  const onDisk = presence().movieFiles;
  const rows = db
    .select({ listId: movieListItems.listId, movie: movies })
    .from(movieListItems)
    .innerJoin(movies, eq(movieListItems.movieId, movies.id))
    .where(inArray(movieListItems.listId, listIds))
    .all();
  for (const row of rows) {
    if (onDisk.has(row.movie.id)) members.get(row.listId)?.push(row.movie);
  }
  for (const list of members.values()) list.sort(byTitle);
  return members;
}

/** Every list of the profile, by name. `preview` adds the first movies of each, for the TV rails. */
export function listMovieLists(options: { preview?: boolean } = {}): MovieListSummary[] {
  const lists = ownLists().sort(byName);
  const members = presentMembers(lists.map((list) => list.id));
  const context = options.preview ? watchContext() : null;
  return lists.map((list) => {
    const inList = members.get(list.id) ?? [];
    const summary: MovieListSummary = {
      id: list.id,
      name: list.name,
      count: inList.length,
      posters: inList.slice(0, 4).map((movie) => movie.posterPath),
    };
    if (context) summary.preview = inList.slice(0, MOVIE_LIST_PREVIEW).map((movie) => movieSummary(movie, context));
    return summary;
  });
}

export function movieListDetail(id: string): MovieListDetail | null {
  const list = ownList(id);
  if (!list) return null;
  const context = watchContext();
  const inList = presentMembers([id]).get(id) ?? [];
  return { id: list.id, name: list.name, movies: inList.map((movie) => movieSummary(movie, context)) };
}

export function createMovieList(input: { name?: unknown }): MovieListRef {
  getProfile();
  const name = checkedName(input.name);
  const now = Date.now();
  const id = randomUUID();
  db.insert(movieLists).values({ id, profileId: PROFILE_ID, name, createdAt: now, updatedAt: now }).run();
  return { id, name };
}

export function renameMovieList(id: string, input: { name?: unknown }): MovieListRef | null {
  if (!ownList(id)) return null;
  const name = checkedName(input.name, id);
  db.update(movieLists).set({ name, updatedAt: Date.now() }).where(eq(movieLists.id, id)).run();
  return { id, name };
}

/** Removes the list and its memberships; the movies themselves stay in the library. */
export function deleteMovieList(id: string) {
  if (!ownList(id)) return false;
  db.delete(movieLists).where(eq(movieLists.id, id)).run();
  return true;
}

function idList(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new ListError("bad_movies");
  return [...new Set(value as string[])];
}

/** Adds and removes movies; unknown movie ids are refused so a typo does not pass silently. */
export function changeMovieList(id: string, input: { add?: unknown; remove?: unknown }) {
  if (!ownList(id)) return null;
  const add = idList(input.add);
  const remove = idList(input.remove);
  if (add.length > 0) {
    const known = new Set(db.select({ id: movies.id }).from(movies).where(inArray(movies.id, add)).all().map((row) => row.id));
    if (known.size !== add.length) throw new ListError("unknown_movie");
  }
  const now = Date.now();
  db.transaction((tx) => {
    if (add.length > 0) {
      tx.insert(movieListItems).values(add.map((movieId) => ({ listId: id, movieId, addedAt: now }))).onConflictDoNothing().run();
    }
    if (remove.length > 0) {
      tx.delete(movieListItems).where(and(eq(movieListItems.listId, id), inArray(movieListItems.movieId, remove))).run();
    }
    tx.update(movieLists).set({ updatedAt: now }).where(eq(movieLists.id, id)).run();
  });
  return listMovieLists().find((list) => list.id === id) ?? null;
}
