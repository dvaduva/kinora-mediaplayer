import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ArtworkOption, CastMember, MovieArtwork, MovieReview, TmdbCandidate, Trailer } from "@kinora/shared";
import { dataDir } from "../paths.js";
import { getSetting } from "../settings.js";
import { titlesEqual } from "../parse/names.js";
import { createQueue } from "./gate.js";
import { downloadTmdbImages } from "./images.js";
import { pickTrailer, rankVideos, type TrailerCandidate } from "./trailer.js";

// One in-flight TMDB call at a time — parallel connects pile up and hit Connect Timeout on flaky links.
const enqueueTmdb = createQueue();

export class TmdbNotConfiguredError extends Error {
  constructor() {
    super("tmdb_not_configured");
  }
}

export class TmdbUnreachableError extends Error {
  constructor() {
    super("tmdb_unreachable");
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function isConnectFailure(error: unknown) {
  const message = error instanceof Error ? `${error.message} ${error.cause ?? ""}` : String(error);
  return /connect timeout|fetch failed|network|econnreset|enotfound|etimedout|undici/i.test(message);
}

/**
 * UI may send "Arrival 2016". TMDB often returns nothing when the year is inside `query`
 * (especially with ro-RO), so we split title/year and filter with API params + local ranking.
 */
export function parseSearchInput(query: string, year: number | null) {
  const trimmed = query.trim().replace(/\s+/g, " ");
  const fromQuery = trimmed.match(/^(.*?)(?:\s*[(\[]?\s*)((?:19|20)\d{2})(?:\s*[)\]]?\s*)?$/);
  const parsedYear = fromQuery ? Number(fromQuery[2]) : null;
  const title = (fromQuery?.[1] ?? trimmed).replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const resolvedYear = year ?? (Number.isFinite(parsedYear) ? parsedYear : null);
  return { title: title || trimmed, year: resolvedYear };
}

/** @deprecated kept for tests — prefer parseSearchInput */
export function withYearQuery(query: string, year: number | null) {
  const { title, year: resolved } = parseSearchInput(query, year);
  return resolved == null ? title : `${title} ${resolved}`;
}

function shouldCacheBody(urlPath: string, body: unknown) {
  if (!urlPath.includes("/search/")) return true;
  const results = list(record(body)?.results);
  // Empty search hits used to stick forever and made Identify look broken.
  return results.length > 0;
}

/** Cached body, unless it is older than `maxAgeMs` (responses are otherwise kept forever). */
function readCache(cacheFile: string, maxAgeMs?: number) {
  try {
    const stat = fs.statSync(cacheFile);
    if (maxAgeMs != null && Date.now() - stat.mtimeMs > maxAgeMs) return undefined;
    return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function tmdbGet(urlPath: string, maxAgeMs?: number): Promise<unknown> {
  const token = getSetting("tmdbReadToken");
  if (!token) throw new TmdbNotConfiguredError();
  const cacheFile = path.join(dataDir, "cache", "tmdb", `${createHash("sha1").update(urlPath).digest("hex")}.json`);
  const cached = readCache(cacheFile, maxAgeMs);
  if (cached !== undefined) return cached;

  return enqueueTmdb(async () => {
    const fresh = readCache(cacheFile, maxAgeMs);
    if (fresh !== undefined) return fresh;

    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(`https://api.themoviedb.org/3${urlPath}`, {
          headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
          signal: AbortSignal.timeout(30_000),
        });
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 600 * (attempt + 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        if (!response.ok) throw new Error(`tmdb_${response.status}`);
        const body = (await response.json()) as unknown;
        if (shouldCacheBody(urlPath, body)) {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, JSON.stringify(body));
        }
        return body;
      } catch (error) {
        lastError = error;
        if (error instanceof Error && /^tmdb_\d+$/.test(error.message)) throw error;
        if (attempt < 3 && isConnectFailure(error)) {
          await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
          continue;
        }
        break;
      }
    }
    if (isConnectFailure(lastError)) throw new TmdbUnreachableError();
    throw lastError instanceof Error ? lastError : new TmdbUnreachableError();
  });
}

function yearFrom(date: string | null) {
  if (!date || date.length < 4) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function translated(details: Record<string, unknown>, field: "overview" | "title" | "name") {
  const direct = text(details[field]);
  if (direct) return direct;
  const translations = record(details.translations);
  const english = list(translations?.translations)
    .map(record)
    .find((item) => item?.iso_639_1 === "en");
  const data = record(english?.data);
  return text(data?.[field]) ?? text(details.original_title) ?? text(details.original_name);
}

export interface TmdbHit {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  releaseDate: string | null;
}

function movieHit(value: unknown): TmdbHit | null {
  const item = record(value);
  const id = numberValue(item?.id);
  const title = text(item?.title);
  if (!item || id == null || !title) return null;
  const releaseDate = text(item.release_date);
  return {
    tmdbId: id,
    title,
    originalTitle: text(item.original_title),
    year: yearFrom(releaseDate),
    releaseDate,
  };
}

function seriesHit(value: unknown): TmdbHit | null {
  const item = record(value);
  const id = numberValue(item?.id);
  const title = text(item?.name);
  if (!item || id == null || !title) return null;
  const releaseDate = text(item.first_air_date);
  return {
    tmdbId: id,
    title,
    originalTitle: text(item.original_name),
    year: yearFrom(releaseDate),
    releaseDate,
  };
}

function yearsClose(fileYear: number | null, releaseYear: number | null) {
  if (fileYear == null) return true;
  if (releaseYear == null) return false;
  return Math.abs(fileYear - releaseYear) <= 1;
}

export function chooseMatch(title: string, year: number | null, hits: TmdbHit[]) {
  const exact = hits.filter(
    (hit) => (titlesEqual(title, hit.title) || (hit.originalTitle && titlesEqual(title, hit.originalTitle))) && yearsClose(year, hit.year),
  );
  if (year != null) return exact.length === 1 ? exact[0] : null;
  const exactTitle = hits.filter((hit) => titlesEqual(title, hit.title) || (hit.originalTitle != null && titlesEqual(title, hit.originalTitle)));
  return exactTitle.length === 1 ? exactTitle[0] : null;
}

async function movieSearchRaw(title: string, year: number | null, mode: "primary" | "any" | "none") {
  const params = new URLSearchParams({ query: title, language: "ro-RO", include_adult: "false" });
  if (year != null && mode === "primary") params.set("primary_release_year", String(year));
  if (year != null && mode === "any") params.set("year", String(year));
  const body = record(await tmdbGet(`/search/movie?${params}`));
  return list(body?.results).map(movieHit).filter((hit): hit is TmdbHit => hit != null);
}

function rankHits(hits: TmdbHit[], year: number | null) {
  const scored = hits.map((hit, index) => ({
    hit,
    index,
    yearScore: year == null ? 0 : hit.year != null && Math.abs(hit.year - year) <= 1 ? 0 : hit.year == null ? 2 : 5,
  }));
  scored.sort((a, b) => a.yearScore - b.yearScore || a.index - b.index);
  return scored.map((item) => item.hit);
}

export async function searchMovies(query: string, year: number | null) {
  const parsed = parseSearchInput(query, year);
  if (parsed.year != null) {
    const primary = await movieSearchRaw(parsed.title, parsed.year, "primary");
    if (primary.length) return primary;
    const anyYear = await movieSearchRaw(parsed.title, parsed.year, "any");
    if (anyYear.length) return anyYear;
  }
  return rankHits(await movieSearchRaw(parsed.title, null, "none"), parsed.year);
}

export async function searchSeries(query: string, year: number | null) {
  const parsed = parseSearchInput(query, year);
  const params = new URLSearchParams({ query: parsed.title, language: "ro-RO" });
  if (parsed.year != null) params.set("first_air_date_year", String(parsed.year));
  let hits = list(record(await tmdbGet(`/search/tv?${params}`))?.results)
    .map(seriesHit)
    .filter((hit): hit is TmdbHit => hit != null);
  if (!hits.length && parsed.year != null) {
    const fallback = new URLSearchParams({ query: parsed.title, language: "ro-RO" });
    hits = list(record(await tmdbGet(`/search/tv?${fallback}`))?.results)
      .map(seriesHit)
      .filter((hit): hit is TmdbHit => hit != null);
  }
  return rankHits(hits, parsed.year);
}

export function toCandidates(hits: TmdbHit[], posters: (string | null)[]): TmdbCandidate[] {
  return hits.map((hit, index) => ({
    tmdbId: hit.tmdbId,
    title: hit.title,
    year: hit.year,
    overview: null,
    posterPath: posters[index] ?? null,
  }));
}

function candidateFrom(item: unknown): TmdbCandidate | null {
  const hit = movieHit(item) ?? seriesHit(item);
  const row = record(item);
  if (!hit) return null;
  return { tmdbId: hit.tmdbId, title: hit.title, year: hit.year, overview: text(row?.overview), posterPath: text(row?.poster_path) };
}

function rankCandidates(items: TmdbCandidate[], year: number | null) {
  const scored = items.map((item, index) => ({
    item,
    index,
    yearScore: year == null ? 0 : item.year != null && Math.abs(item.year - year) <= 1 ? 0 : item.year == null ? 2 : 5,
  }));
  scored.sort((a, b) => a.yearScore - b.yearScore || a.index - b.index);
  return scored.map((entry) => entry.item);
}

async function movieCandidateSearch(title: string, year: number | null, mode: "primary" | "any" | "none") {
  const params = new URLSearchParams({ query: title, language: "ro-RO", include_adult: "false" });
  if (year != null && mode === "primary") params.set("primary_release_year", String(year));
  if (year != null && mode === "any") params.set("year", String(year));
  const body = record(await tmdbGet(`/search/movie?${params}`));
  return list(body?.results)
    .map(candidateFrom)
    .filter((item): item is TmdbCandidate => item != null);
}

export async function searchMovieCandidates(query: string, year: number | null): Promise<TmdbCandidate[]> {
  const parsed = parseSearchInput(query, year);
  if (parsed.year != null) {
    const primary = await movieCandidateSearch(parsed.title, parsed.year, "primary");
    if (primary.length) return rankCandidates(primary, parsed.year).slice(0, 8);
    const anyYear = await movieCandidateSearch(parsed.title, parsed.year, "any");
    if (anyYear.length) return rankCandidates(anyYear, parsed.year).slice(0, 8);
  }
  const loose = await movieCandidateSearch(parsed.title, null, "none");
  return rankCandidates(loose, parsed.year).slice(0, 8);
}

export async function searchSeriesCandidates(query: string, year: number | null): Promise<TmdbCandidate[]> {
  const parsed = parseSearchInput(query, year);
  const params = new URLSearchParams({ query: parsed.title, language: "ro-RO" });
  if (parsed.year != null) params.set("first_air_date_year", String(parsed.year));
  let results = list(record(await tmdbGet(`/search/tv?${params}`))?.results)
    .map(candidateFrom)
    .filter((item): item is TmdbCandidate => item != null);
  if (!results.length && parsed.year != null) {
    const fallback = new URLSearchParams({ query: parsed.title, language: "ro-RO" });
    results = list(record(await tmdbGet(`/search/tv?${fallback}`))?.results)
      .map(candidateFrom)
      .filter((item): item is TmdbCandidate => item != null);
  }
  return rankCandidates(results, parsed.year).slice(0, 8);
}

interface CrewName {
  id: number | null;
  name: string;
}

function namesOf(credits: Record<string, unknown> | null, job: string): CrewName[] {
  return list(credits?.crew)
    .map(record)
    .filter((person) => person?.job === job)
    .map((person) => ({ id: numberValue(person?.id), name: text(person?.name) }))
    .filter((person): person is CrewName => person.name != null);
}

function castOf(credits: Record<string, unknown> | null): CastMember[] {
  return list(credits?.cast)
    .map(record)
    .filter((person) => text(person?.name))
    .slice(0, 12)
    .map((person) => ({
      tmdbPersonId: numberValue(person?.id),
      name: text(person?.name) ?? "",
      character: text(person?.character),
      profilePath: text(person?.profile_path),
    }));
}

/** True when the name contains letters outside the Latin script (Cyrillic, Greek, CJK, ...). */
export function isNonLatinName(name: string) {
  return /\p{L}/u.test(name) && /(?![\p{Script=Latin}])\p{L}/u.test(name);
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", ё: "yo", є: "ye", ж: "zh", з: "z", и: "i", і: "i",
  ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ђ: "đ", ј: "j", љ: "lj", њ: "nj", ћ: "ć", џ: "dž", ў: "u",
};

/** Last-resort transliteration when TMDB has no Latin form of a name. */
export function transliterateName(name: string) {
  let output = "";
  const chars = [...name];
  chars.forEach((char, index) => {
    const lower = char.toLowerCase();
    let mapped = CYRILLIC_TO_LATIN[lower];
    if (mapped == null) {
      output += char;
      return;
    }
    // "Е" at the start of a word reads "Ye" in Russian (Екамасова -> Yekamasova).
    if (lower === "е" && (index === 0 || !/\p{L}/u.test(chars[index - 1] ?? ""))) mapped = "ye";
    if (char !== lower && mapped.length > 0) {
      const nextUpper = chars[index + 1] != null && chars[index + 1] !== chars[index + 1]!.toLowerCase();
      mapped = nextUpper ? mapped.toUpperCase() : mapped[0]!.toUpperCase() + mapped.slice(1);
    }
    output += mapped;
  });
  return output;
}

function latinCandidate(value: unknown) {
  const name = text(value);
  return name && !isNonLatinName(name) ? name : null;
}

async function latinPersonName(personId: number | null, name: string): Promise<string> {
  if (!isNonLatinName(name)) return name;
  if (personId != null) {
    try {
      const person = record(await tmdbGet(`/person/${personId}?language=en-US&append_to_response=translations`));
      const translations = list(record(person?.translations)?.translations).map(record);
      const preferred = ["en", "ro"]
        .map((language) => translations.find((item) => item?.iso_639_1 === language))
        .map((item) => latinCandidate(record(item?.data)?.name))
        .find((value) => value != null);
      const alias = list(person?.also_known_as).map(latinCandidate).find((value) => value != null);
      const resolved = preferred ?? alias;
      if (resolved) return resolved;
    } catch {
      // Fall through to local transliteration — a missing name must never block matching.
    }
  }
  return transliterateName(name);
}

export interface TmdbPerson {
  name: string;
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  profilePath: string | null;
  knownFor: string | null;
  imdbId: string | null;
}

/** Person profile; Romanian biography when TMDB has one, English otherwise. Shares the cache entry used by name latinization. */
export async function fetchPerson(personId: number): Promise<TmdbPerson | null> {
  const person = record(await tmdbGet(`/person/${personId}?language=en-US&append_to_response=translations`));
  if (!person) return null;
  const translations = list(record(person.translations)?.translations).map(record);
  const romanian = text(record(translations.find((item) => item?.iso_639_1 === "ro")?.data)?.biography);
  const name = text(person.name) ?? "";
  return {
    name: await latinPersonName(personId, name),
    biography: romanian ?? text(person.biography),
    birthday: text(person.birthday),
    deathday: text(person.deathday),
    placeOfBirth: text(person.place_of_birth),
    profilePath: text(person.profile_path),
    knownFor: text(person.known_for_department),
    imdbId: text(person.imdb_id),
  };
}

async function latinizeCast(cast: CastMember[]) {
  return Promise.all(
    cast.map(async (member) => ({ ...member, name: await latinPersonName(member.tmdbPersonId ?? null, member.name) })),
  );
}

async function latinizeCrew(people: CrewName[]) {
  const names = await Promise.all(people.map((person) => latinPersonName(person.id, person.name)));
  return names.filter((name, index, all) => all.indexOf(name) === index);
}

function videosOf(body: unknown): TrailerCandidate[] {
  const results = list(record(body)?.results);
  return results
    .map(record)
    .filter((video) => text(video?.key) && text(video?.site))
    .map((video) => ({
      key: text(video?.key) ?? "",
      name: text(video?.name) ?? "Trailer",
      site: text(video?.site) ?? "",
      type: text(video?.type) ?? "",
      official: video?.official === true,
      language: text(video?.iso_639_1),
      publishedAt: text(video?.published_at),
    }));
}

function similarOf(details: Record<string, unknown>, titleField: "title" | "name") {
  const recommendations = record(details.recommendations);
  return list(recommendations?.results)
    .map(record)
    .slice(0, 12)
    .map((item) => {
      const id = numberValue(item?.id);
      const title = text(item?.[titleField]) ?? text(item?.title) ?? text(item?.name);
      if (id == null || !title) return null;
      const date = text(item?.release_date) ?? text(item?.first_air_date);
      return {
        tmdbId: id,
        title,
        year: yearFrom(date),
        posterPath: text(item?.poster_path),
        mediaType: (text(item?.media_type) === "tv" ? "tv" : "movie") as "movie" | "tv",
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
}

function releaseDateOf(details: Record<string, unknown>) {
  const results = list(record(details.release_dates)?.results).map(record);
  const romanian = results.find((item) => item?.iso_3166_1 === "RO");
  const dates = list(romanian?.release_dates).map(record);
  const theatrical = dates.find((item) => item?.type === 3) ?? dates[0];
  const chosen = text(theatrical?.release_date) ?? text(details.release_date);
  return chosen ? chosen.slice(0, 10) : null;
}

function preferredPoster(images: unknown, fallback: string | null) {
  const posters = list(record(images)?.posters)
    .map(record)
    .filter((image) => text(image?.file_path));
  const rank = (language: unknown) => (language === "ro" ? 0 : language === "en" ? 1 : language == null ? 2 : 3);
  posters.sort((a, b) => rank(a?.iso_639_1) - rank(b?.iso_639_1));
  return text(posters[0]?.file_path) ?? fallback;
}

function preferredBackdrop(images: unknown, fallback: string | null) {
  const backdrops = list(record(images)?.backdrops)
    .map(record)
    .filter((image) => text(image?.file_path));
  const textFree = backdrops.find((image) => image?.iso_639_1 == null);
  const english = backdrops.find((image) => image?.iso_639_1 === "en");
  return text(textFree?.file_path) ?? text(english?.file_path) ?? text(backdrops[0]?.file_path) ?? fallback;
}

function stillsOf(images: unknown) {
  return list(record(images)?.backdrops)
    .map(record)
    .filter((image) => text(image?.file_path))
    .slice(0, 8)
    .map((image) => text(image?.file_path))
    .filter((item): item is string => item != null);
}

export interface MovieMetadata {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  tagline: string | null;
  runtime: number | null;
  releaseDate: string | null;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  genres: string[];
  directors: string[];
  writers: string[];
  cast: CastMember[];
  stills: string[];
  similar: ReturnType<typeof similarOf>;
  trailer: Trailer | null;
  /** Trailers, teasers and clips, best first (not stored for library titles). */
  videos: Trailer[];
}

export async function fetchMovie(tmdbId: number): Promise<MovieMetadata> {
  // One round-trip: parallel detail/image/video calls were timing out on this network.
  const details = record(
    await tmdbGet(
      `/movie/${tmdbId}?language=ro-RO&append_to_response=credits,recommendations,external_ids,translations,release_dates,images,videos&include_image_language=ro,en,null&include_video_language=ro,en,null`,
    ),
  );
  if (!details) throw new Error("tmdb_empty");
  const images = details.images;
  const videos = videosOf(details.videos);
  const credits = record(details.credits);
  const poster = preferredPoster(images, text(details.poster_path));
  const backdropPath = preferredBackdrop(images, text(details.backdrop_path));
  const cast = await latinizeCast(castOf(credits));
  const directors = await latinizeCrew(namesOf(credits, "Director"));
  const writers = await latinizeCrew([
    ...namesOf(credits, "Screenplay"),
    ...namesOf(credits, "Writer"),
    ...namesOf(credits, "Story"),
  ]);
  const stills = stillsOf(images);
  const similar = similarOf(details, "title");
  const trailer = pickTrailer(videos);
  // Never block matching on CDN downloads — posters load via redirect.
  void downloadTmdbImages([
    { size: "w342", path: poster },
    { size: "w1280", path: backdropPath },
    ...stills.map((item) => ({ size: "w780", path: item })),
    ...cast.map((person) => ({ size: "w185", path: person.profilePath })),
    ...similar.map((item) => ({ size: "w342", path: item.posterPath })),
  ]);
  const releaseDate = releaseDateOf(details);
  return {
    tmdbId,
    imdbId: text(record(details.external_ids)?.imdb_id),
    title: translated(details, "title") ?? `TMDB ${tmdbId}`,
    originalTitle: text(details.original_title),
    overview: translated(details, "overview"),
    tagline: text(details.tagline),
    runtime: numberValue(details.runtime),
    releaseDate,
    year: yearFrom(releaseDate),
    posterPath: poster,
    backdropPath,
    rating: numberValue(details.vote_average),
    genres: list(details.genres)
      .map((genre) => text(record(genre)?.name))
      .filter((name): name is string => name != null),
    directors,
    writers,
    cast,
    stills,
    similar,
    trailer,
    videos: rankVideos(videos),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Community reviews from TMDB (mostly English), newest first. */
export async function fetchMovieReviews(tmdbId: number): Promise<MovieReview[]> {
  const body = record(await tmdbGet(`/movie/${tmdbId}/reviews?language=en-US&page=1`, 3 * DAY_MS));
  return list(body?.results)
    .map(record)
    .map((item): MovieReview | null => {
      const id = text(item?.id);
      const content = text(item?.content);
      if (!item || !id || !content) return null;
      const details = record(item.author_details);
      const rawRating = numberValue(details?.rating);
      const avatar = text(details?.avatar_path);
      return {
        id: `tmdb-${id}`,
        source: "tmdb",
        author: text(item.author) ?? text(details?.username) ?? "TMDB",
        // Older accounts store a Gravatar URL here; only TMDB image paths go through the image proxy.
        avatarUrl: avatar && /^\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(avatar) ? avatar : null,
        rating: rawRating != null ? Math.round(rawRating) / 2 : null,
        body: content.replace(/\r\n/g, "\n").replace(/\*\*|__/g, "").trim(),
        date: text(item.updated_at) ?? text(item.created_at),
        url: text(item.url),
      };
    })
    .filter((item): item is MovieReview => item != null)
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

function artworkOf(images: unknown, field: "posters" | "backdrops"): ArtworkOption[] {
  return list(record(images)?.[field])
    .map(record)
    .map((image) => {
      const filePath = text(image?.file_path);
      if (!filePath) return null;
      return {
        path: filePath,
        language: text(image?.iso_639_1),
        width: numberValue(image?.width) ?? 0,
        height: numberValue(image?.height) ?? 0,
        votes: numberValue(image?.vote_count) ?? 0,
      };
    })
    .filter((item): item is ArtworkOption => item != null)
    .slice(0, 60);
}

/** Every poster and backdrop TMDB has for a movie, for picking artwork by hand. */
export async function fetchMovieArtwork(tmdbId: number): Promise<MovieArtwork> {
  const images = await tmdbGet(`/movie/${tmdbId}/images?include_image_language=ro,en,null`, 7 * DAY_MS);
  return { posters: artworkOf(images, "posters"), backdrops: artworkOf(images, "backdrops") };
}

export interface SeriesMetadata {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  genres: string[];
  creators: string[];
  cast: CastMember[];
  similar: ReturnType<typeof similarOf>;
  trailer: Trailer | null;
  /** Trailers, teasers and clips, best first (not stored for library titles). */
  videos: Trailer[];
}

export async function fetchSeries(tmdbId: number): Promise<SeriesMetadata> {
  const details = record(
    await tmdbGet(
      `/tv/${tmdbId}?language=ro-RO&append_to_response=credits,recommendations,external_ids,translations,images,videos&include_image_language=ro,en,null&include_video_language=ro,en,null`,
    ),
  );
  if (!details) throw new Error("tmdb_empty");
  const images = details.images;
  const videos = videosOf(details.videos);
  const credits = record(details.credits);
  const poster = preferredPoster(images, text(details.poster_path));
  const backdropPath = preferredBackdrop(images, text(details.backdrop_path));
  const cast = await latinizeCast(castOf(credits));
  const creators = await latinizeCrew(
    list(details.created_by)
      .map(record)
      .map((person) => ({ id: numberValue(person?.id), name: text(person?.name) }))
      .filter((person): person is CrewName => person.name != null),
  );
  const similar = similarOf(details, "name");
  const trailer = pickTrailer(videos);
  const airDate = text(details.first_air_date);
  void downloadTmdbImages([
    { size: "w342", path: poster },
    { size: "w1280", path: backdropPath },
    ...cast.map((person) => ({ size: "w185", path: person.profilePath })),
    ...similar.map((item) => ({ size: "w342", path: item.posterPath })),
  ]);
  return {
    tmdbId,
    imdbId: text(record(details.external_ids)?.imdb_id),
    title: translated(details, "name") ?? `TMDB ${tmdbId}`,
    originalTitle: text(details.original_name),
    overview: translated(details, "overview"),
    year: yearFrom(airDate),
    posterPath: poster,
    backdropPath,
    rating: numberValue(details.vote_average),
    genres: list(details.genres)
      .map((genre) => text(record(genre)?.name))
      .filter((name): name is string => name != null),
    creators,
    cast,
    similar,
    trailer,
    videos: rankVideos(videos),
  };
}

export interface EpisodeMetadata {
  episodeNumber: number;
  title: string;
  overview: string | null;
  stillPath: string | null;
  runtime: number | null;
  airDate: string | null;
}

export async function fetchSeason(tmdbId: number, seasonNumber: number) {
  const body = record(await tmdbGet(`/tv/${tmdbId}/season/${seasonNumber}?language=ro-RO`));
  const episodes = list(body?.episodes)
    .map(record)
    .map((episode) => {
      const episodeNumber = numberValue(episode?.episode_number);
      const title = text(episode?.name);
      if (episodeNumber == null || !title) return null;
      return {
        episodeNumber,
        title,
        overview: text(episode?.overview),
        stillPath: text(episode?.still_path),
        runtime: numberValue(episode?.runtime),
        airDate: text(episode?.air_date),
      } satisfies EpisodeMetadata;
    })
    .filter((episode): episode is EpisodeMetadata => episode != null);
  await downloadTmdbImages([{ size: "w342", path: text(body?.poster_path) }]);
  void downloadTmdbImages(episodes.map((episode) => ({ size: "w780", path: episode.stillPath })));
  return { name: text(body?.name), overview: text(body?.overview), posterPath: text(body?.poster_path), episodes };
}
