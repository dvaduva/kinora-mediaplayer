import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CastMember, TmdbCandidate, Trailer } from "@kinora/shared";
import { dataDir } from "../paths.js";
import { getSetting } from "../settings.js";
import { titlesEqual } from "../parse/names.js";
import { createGate } from "./gate.js";
import { downloadTmdbImages } from "./images.js";
import { pickTrailer, type TrailerCandidate } from "./trailer.js";

const wait = createGate(250);

export class TmdbNotConfiguredError extends Error {
  constructor() {
    super("tmdb_not_configured");
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

async function tmdbGet(urlPath: string) {
  const token = getSetting("tmdbReadToken");
  if (!token) throw new TmdbNotConfiguredError();
  const cacheFile = path.join(dataDir, "cache", "tmdb", `${createHash("sha1").update(urlPath).digest("hex")}.json`);
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as unknown;
  await wait();
  const response = await fetch(`https://api.themoviedb.org/3${urlPath}`, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`tmdb_${response.status}`);
  const body = (await response.json()) as unknown;
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(body));
  return body;
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

export async function searchMovies(query: string, year: number | null) {
  const params = new URLSearchParams({ query, language: "ro-RO", include_adult: "false" });
  if (year) params.set("primary_release_year", String(year));
  const body = record(await tmdbGet(`/search/movie?${params}`));
  return list(body?.results).map(movieHit).filter((hit): hit is TmdbHit => hit != null);
}

export async function searchSeries(query: string, year: number | null) {
  const params = new URLSearchParams({ query, language: "ro-RO" });
  if (year) params.set("first_air_date_year", String(year));
  const body = record(await tmdbGet(`/search/tv?${params}`));
  return list(body?.results).map(seriesHit).filter((hit): hit is TmdbHit => hit != null);
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

export async function searchMovieCandidates(query: string, year: number | null): Promise<TmdbCandidate[]> {
  const params = new URLSearchParams({ query, language: "ro-RO", include_adult: "false" });
  if (year) params.set("primary_release_year", String(year));
  const body = record(await tmdbGet(`/search/movie?${params}`));
  return list(body?.results)
    .map((item) => {
      const hit = movieHit(item);
      const row = record(item);
      if (!hit) return null;
      return { tmdbId: hit.tmdbId, title: hit.title, year: hit.year, overview: text(row?.overview), posterPath: text(row?.poster_path) };
    })
    .filter((item): item is TmdbCandidate => item != null)
    .slice(0, 8);
}

export async function searchSeriesCandidates(query: string, year: number | null): Promise<TmdbCandidate[]> {
  const params = new URLSearchParams({ query, language: "ro-RO" });
  if (year) params.set("first_air_date_year", String(year));
  const body = record(await tmdbGet(`/search/tv?${params}`));
  return list(body?.results)
    .map((item) => {
      const hit = seriesHit(item);
      const row = record(item);
      if (!hit) return null;
      return { tmdbId: hit.tmdbId, title: hit.title, year: hit.year, overview: text(row?.overview), posterPath: text(row?.poster_path) };
    })
    .filter((item): item is TmdbCandidate => item != null)
    .slice(0, 8);
}

function namesOf(credits: Record<string, unknown> | null, job: string) {
  return list(credits?.crew)
    .map(record)
    .filter((person) => person?.job === job)
    .map((person) => text(person?.name))
    .filter((name): name is string => name != null);
}

function castOf(credits: Record<string, unknown> | null): CastMember[] {
  return list(credits?.cast)
    .map(record)
    .filter((person) => text(person?.name))
    .slice(0, 12)
    .map((person) => ({
      name: text(person?.name) ?? "",
      character: text(person?.character),
      profilePath: text(person?.profile_path),
    }));
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
}

export async function fetchMovie(tmdbId: number): Promise<MovieMetadata> {
  const details = record(
    await tmdbGet(
      `/movie/${tmdbId}?language=ro-RO&append_to_response=credits,recommendations,external_ids,translations,release_dates`,
    ),
  );
  if (!details) throw new Error("tmdb_empty");
  const images = await tmdbGet(`/movie/${tmdbId}/images?include_image_language=ro,en,null`);
  const videos = videosOf(await tmdbGet(`/movie/${tmdbId}/videos?include_video_language=ro,en,null`));
  const credits = record(details.credits);
  const poster = preferredPoster(images, text(details.poster_path));
  const backdropPath = preferredBackdrop(images, text(details.backdrop_path));
  const cast = castOf(credits);
  const stills = stillsOf(images);
  const similar = similarOf(details, "title");
  const trailer = pickTrailer(videos);
  await downloadTmdbImages([
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
    directors: namesOf(credits, "Director"),
    writers: [...namesOf(credits, "Screenplay"), ...namesOf(credits, "Writer"), ...namesOf(credits, "Story")].filter(
      (name, index, all) => all.indexOf(name) === index,
    ),
    cast,
    stills,
    similar,
    trailer,
  };
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
}

export async function fetchSeries(tmdbId: number): Promise<SeriesMetadata> {
  const details = record(
    await tmdbGet(`/tv/${tmdbId}?language=ro-RO&append_to_response=credits,recommendations,external_ids,translations`),
  );
  if (!details) throw new Error("tmdb_empty");
  const images = await tmdbGet(`/tv/${tmdbId}/images?include_image_language=ro,en,null`);
  const videos = videosOf(await tmdbGet(`/tv/${tmdbId}/videos?include_video_language=ro,en,null`));
  const credits = record(details.credits);
  const poster = preferredPoster(images, text(details.poster_path));
  const backdropPath = preferredBackdrop(images, text(details.backdrop_path));
  const cast = castOf(credits);
  const similar = similarOf(details, "name");
  const trailer = pickTrailer(videos);
  const airDate = text(details.first_air_date);
  await downloadTmdbImages([
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
    creators: list(details.created_by)
      .map((person) => text(record(person)?.name))
      .filter((name): name is string => name != null),
    cast,
    similar,
    trailer,
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
  await downloadTmdbImages([
    { size: "w342", path: text(body?.poster_path) },
    ...episodes.map((episode) => ({ size: "w780", path: episode.stillPath })),
  ]);
  return { name: text(body?.name), overview: text(body?.overview), posterPath: text(body?.poster_path), episodes };
}
