import { and, eq } from "drizzle-orm";
import type { ExternalRatings, MovieArtwork, MovieEdit, MovieEditField, MovieReview, MovieReviews, OwnReview } from "@kinora/shared";
import { isMovieEditField, isStarRating, parseLockedFields } from "@kinora/shared";
import { db, parseJson } from "./db/index.js";
import { movieReviews, movies } from "./db/schema.js";
import { isTmdbImagePath } from "./metadata/images.js";
import { fetchExternalRatings, normalizeRtSlug } from "./metadata/ratings.js";
import { fetchMovieArtwork, fetchMovieReviews } from "./metadata/tmdb.js";
import { getSetting, PROFILE_ID } from "./settings.js";

type MovieRow = typeof movies.$inferSelect;
type MovieChange = Partial<typeof movies.$inferInsert>;

/** Columns each editable field writes; re-matching skips the columns of locked fields. */
export const FIELD_COLUMNS: Record<MovieEditField, (keyof MovieChange)[]> = {
  title: ["title"],
  sortTitle: ["sortTitle"],
  originalTitle: ["originalTitle"],
  edition: ["edition"],
  year: ["year"],
  releaseDate: ["releaseDate"],
  tagline: ["tagline"],
  overview: ["overview"],
  genres: ["genresJson"],
  directors: ["directorsJson"],
  writers: ["writersJson"],
  posterPath: ["posterPath"],
  backdropPath: ["backdropPath"],
  imdbId: ["imdbId"],
  rtSlug: ["rtSlug"],
};

/** Drops the columns of locked fields from a metadata update. */
export function withoutLocked(change: MovieChange, lockedJson: string) {
  const result = { ...change };
  for (const field of parseLockedFields(lockedJson)) {
    for (const column of FIELD_COLUMNS[field]) delete result[column];
  }
  return result;
}

export class EditError extends Error {}

function optionalText(value: unknown, field: string, max = 400) {
  if (value === null) return null;
  if (typeof value !== "string") throw new EditError(`bad_${field}`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new EditError(`bad_${field}`);
  return trimmed || null;
}

function nameList(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new EditError(`bad_${field}`);
  const names = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 120);
  return [...new Set(names)].slice(0, 40);
}

/** Validates an edit from the dialog and turns it into a row update. */
export function movieChange(body: Record<string, unknown>): { change: MovieChange; ratingsStale: boolean } {
  const change: MovieChange = {};
  const edit = body as MovieEdit & Record<string, unknown>;
  if (edit.title !== undefined) {
    const title = optionalText(edit.title, "title");
    if (!title) throw new EditError("bad_title");
    change.title = title;
  }
  if (edit.sortTitle !== undefined) change.sortTitle = optionalText(edit.sortTitle, "sort_title");
  if (edit.originalTitle !== undefined) change.originalTitle = optionalText(edit.originalTitle, "original_title");
  if (edit.edition !== undefined) change.edition = optionalText(edit.edition, "edition", 80);
  if (edit.tagline !== undefined) change.tagline = optionalText(edit.tagline, "tagline");
  if (edit.overview !== undefined) change.overview = optionalText(edit.overview, "overview", 8000);
  if (edit.year !== undefined) {
    if (edit.year !== null && !(Number.isInteger(edit.year) && edit.year >= 1870 && edit.year <= 2200)) throw new EditError("bad_year");
    change.year = edit.year;
  }
  if (edit.releaseDate !== undefined) {
    const date = optionalText(edit.releaseDate, "release_date", 10);
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) throw new EditError("bad_release_date");
    change.releaseDate = date;
  }
  if (edit.genres !== undefined) change.genresJson = JSON.stringify(nameList(edit.genres, "genres"));
  if (edit.directors !== undefined) change.directorsJson = JSON.stringify(nameList(edit.directors, "directors"));
  if (edit.writers !== undefined) change.writersJson = JSON.stringify(nameList(edit.writers, "writers"));
  for (const field of ["posterPath", "backdropPath"] as const) {
    if (edit[field] === undefined) continue;
    const value = edit[field];
    if (value !== null && (typeof value !== "string" || !isTmdbImagePath(value))) throw new EditError(`bad_${field}`);
    change[field] = value;
  }
  let ratingsStale = false;
  if (edit.imdbId !== undefined) {
    const imdbId = optionalText(edit.imdbId, "imdb_id", 20);
    if (imdbId && !/^tt\d{5,10}$/.test(imdbId)) throw new EditError("bad_imdb_id");
    change.imdbId = imdbId;
    ratingsStale = true;
  }
  if (edit.rtSlug !== undefined) {
    const raw = optionalText(edit.rtSlug, "rt_slug", 300);
    const slug = raw ? normalizeRtSlug(raw) : null;
    if (raw && !slug) throw new EditError("bad_rt_slug");
    change.rtSlug = slug;
    ratingsStale = true;
  }
  if (edit.locked !== undefined) {
    if (!Array.isArray(edit.locked) || !edit.locked.every(isMovieEditField)) throw new EditError("bad_locked");
    change.lockedJson = JSON.stringify([...new Set(edit.locked)]);
  }
  if (ratingsStale) change.externalRatingsAt = null;
  return { change, ratingsStale };
}

export function updateMovie(movieId: string, body: Record<string, unknown>) {
  const movie = db.select({ id: movies.id }).from(movies).where(eq(movies.id, movieId)).get();
  if (!movie) return false;
  const { change } = movieChange(body);
  if (Object.keys(change).length > 0) db.update(movies).set(change).where(eq(movies.id, movieId)).run();
  return true;
}

// ---- The profile's own review ----

function ownRow(movieId: string) {
  return db
    .select()
    .from(movieReviews)
    .where(and(eq(movieReviews.profileId, PROFILE_ID), eq(movieReviews.movieId, movieId)))
    .get();
}

export function ownReview(movieId: string): OwnReview | null {
  const row = ownRow(movieId);
  return row ? { rating: row.rating, body: row.body, updatedAt: row.updatedAt } : null;
}

/** Saves the rating and text; clearing both removes the review. Returns null when the movie does not exist. */
export function saveOwnReview(movieId: string, body: Record<string, unknown>): OwnReview | null | "invalid" {
  if (!db.select({ id: movies.id }).from(movies).where(eq(movies.id, movieId)).get()) return null;
  const rating = body.rating ?? null;
  const text = body.body ?? null;
  if (rating !== null && !isStarRating(rating)) return "invalid";
  if (text !== null && (typeof text !== "string" || text.length > 8000)) return "invalid";
  const trimmed = typeof text === "string" ? text.trim() || null : null;
  const where = and(eq(movieReviews.profileId, PROFILE_ID), eq(movieReviews.movieId, movieId));
  if (rating === null && trimmed === null) {
    db.delete(movieReviews).where(where).run();
    return { rating: null, body: null, updatedAt: Date.now() };
  }
  const now = Date.now();
  db.insert(movieReviews)
    .values({ profileId: PROFILE_ID, movieId, rating, body: trimmed, updatedAt: now })
    .onConflictDoUpdate({ target: [movieReviews.profileId, movieReviews.movieId], set: { rating, body: trimmed, updatedAt: now } })
    .run();
  return { rating, body: trimmed, updatedAt: now };
}

// ---- External ratings and reviews ----

const RATINGS_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

interface StoredRatings {
  ratings: ExternalRatings;
  rtReviews: MovieReview[];
}

const inFlight = new Map<string, Promise<StoredRatings>>();

function storedRatings(movie: MovieRow) {
  return parseJson<StoredRatings | null>(movie.externalRatingsJson, null);
}

/** The TMDB score and OMDb setting come from the current row and settings, not from the cached lookup. */
function present(movie: MovieRow, stored: StoredRatings | null): ExternalRatings {
  const base: ExternalRatings = stored?.ratings ?? { imdb: null, rottenTomatoes: null, metacritic: null, tmdb: null, fetchedAt: null, omdbMissing: true, rtUnreadable: false };
  return {
    ...base,
    tmdb: movie.tmdbId && movie.rating ? { rating: movie.rating, url: `https://www.themoviedb.org/movie/${movie.tmdbId}` } : null,
    omdbMissing: !getSetting("omdbApiKey"),
  };
}

async function refreshRatings(movie: MovieRow): Promise<StoredRatings> {
  const running = inFlight.get(movie.id);
  if (running) return running;
  const task = (async () => {
    const previous = storedRatings(movie);
    const result = await fetchExternalRatings({
      imdbId: movie.imdbId,
      tmdbId: movie.tmdbId,
      tmdbRating: movie.rating,
      title: movie.title,
      originalTitle: movie.originalTitle,
      year: movie.year,
      rtSlugOverride: movie.rtSlug,
      previous: previous?.ratings ?? null,
    });
    const stored: StoredRatings = { ratings: result.ratings, rtReviews: result.rtReviews.length ? result.rtReviews : previous?.rtReviews ?? [] };
    db.update(movies).set({ externalRatingsJson: JSON.stringify(stored), externalRatingsAt: Date.now() }).where(eq(movies.id, movie.id)).run();
    return stored;
  })();
  inFlight.set(movie.id, task);
  try {
    return await task;
  } finally {
    inFlight.delete(movie.id);
  }
}

async function ensureRatings(movie: MovieRow, force: boolean) {
  const stored = storedRatings(movie);
  const fresh = movie.externalRatingsAt != null && Date.now() - movie.externalRatingsAt < RATINGS_MAX_AGE_MS;
  if (stored && fresh && !force) return stored;
  try {
    return await refreshRatings(movie);
  } catch {
    return stored;
  }
}

export async function movieRatings(movieId: string, force = false): Promise<ExternalRatings | null> {
  const movie = db.select().from(movies).where(eq(movies.id, movieId)).get();
  if (!movie) return null;
  return present(movie, await ensureRatings(movie, force));
}

export async function movieReviewList(movieId: string): Promise<MovieReviews | null> {
  const movie = db.select().from(movies).where(eq(movies.id, movieId)).get();
  if (!movie) return null;
  const [stored, tmdb] = await Promise.all([
    ensureRatings(movie, false),
    movie.tmdbId && getSetting("tmdbReadToken") ? fetchMovieReviews(movie.tmdbId).catch(() => [] as MovieReview[]) : Promise.resolve([] as MovieReview[]),
  ]);
  return { own: ownReview(movieId), reviews: [...(stored?.rtReviews ?? []).slice(0, 20), ...tmdb.slice(0, 20)] };
}

export async function movieArtwork(movieId: string): Promise<MovieArtwork | null> {
  const movie = db.select({ tmdbId: movies.tmdbId }).from(movies).where(eq(movies.id, movieId)).get();
  if (!movie) return null;
  if (!movie.tmdbId) return { posters: [], backdrops: [] };
  return fetchMovieArtwork(movie.tmdbId);
}
