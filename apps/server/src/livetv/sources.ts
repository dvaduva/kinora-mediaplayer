import type { AudioStream, CastMember, ChannelOptions, ChannelSource, LibraryType } from "@kinora/shared";
import { eq } from "drizzle-orm";
import { db, parseJson } from "../db/index.js";
import { channels, episodes, libraries, mediaFiles, movies, series } from "../db/schema.js";
import { isNonLatinName, transliterateName } from "../metadata/tmdb.js";
import { playbackPlan } from "../playback/plan.js";
import { tools } from "../process.js";
import { MIN_ITEM_MS, type ScheduleItem } from "./schedule.js";

type MovieRow = typeof movies.$inferSelect;
type SeriesRow = typeof series.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;
type FileRow = typeof mediaFiles.$inferSelect;

function latin(name: string) {
  return isNonLatinName(name) ? transliterateName(name) : name;
}

function key(text: string) {
  return text.trim().toLocaleLowerCase();
}

/** Best present file the browser can play (directly or after conversion), with its duration in ms. */
function bestFiles(): { byMovie: Map<string, { file: FileRow; ms: number | null }>; byEpisode: Map<string, { file: FileRow; ms: number | null }> } {
  const byMovie = new Map<string, { file: FileRow; ms: number | null; score: number }>();
  const byEpisode = new Map<string, { file: FileRow; ms: number | null; score: number }>();
  for (const file of db.select().from(mediaFiles).where(eq(mediaFiles.missing, false)).all()) {
    if (!file.movieId && !file.episodeId) continue;
    const audio = parseJson<AudioStream[]>(file.audioJson, []);
    const plan = playbackPlan({
      missing: file.missing,
      kind: "video",
      container: file.container,
      videoCodec: file.videoCodec,
      audioCodec: audio[0]?.codec ?? null,
      ffmpeg: tools.ffmpeg,
    });
    if (!plan.available) continue;
    // Prefer files that play directly, then the larger picture.
    const score = (plan.mode === "direct" ? 1e12 : 0) + (file.width ?? 0) * (file.height ?? 0);
    const entry = { file, ms: file.duration && file.duration > 0 ? Math.round(file.duration) * 1000 : null, score };
    const map = file.movieId ? byMovie : byEpisode;
    const id = (file.movieId ?? file.episodeId)!;
    const current = map.get(id);
    if (!current || score > current.score) map.set(id, entry);
  }
  return { byMovie, byEpisode };
}

function matchesPerson(names: Set<string>, cast: CastMember[], crew: string[]) {
  return cast.some((member) => names.has(key(member.name)) || names.has(key(latin(member.name)))) || crew.some((name) => names.has(key(name)) || names.has(key(latin(name))));
}

function genreMatch(genres: Set<string>, json: string) {
  return parseJson<string[]>(json, []).some((genre) => genres.has(key(genre)));
}

function yearMatch(decades: number[], year: number | null) {
  return year != null && decades.some((decade) => year >= decade && year < decade + 10);
}

/** Everything a channel's rules match: movies and series episodes with a playable file, deduplicated. */
export function resolveSources(sources: ChannelSource[]): ScheduleItem[] {
  if (sources.length === 0) return [];
  const values = (type: ChannelSource["type"]) => sources.filter((source) => source.type === type).map((source) => source.value);
  const genres = new Set(values("genre").map(key));
  const seriesIds = new Set(values("series"));
  const movieIds = new Set(values("movie"));
  const libraryIds = new Set(values("library"));
  const decades = values("decade").map(Number).filter(Number.isInteger);
  const people = new Set(values("person").map(key));

  const movieMatch = (movie: MovieRow) =>
    movieIds.has(movie.id) ||
    libraryIds.has(movie.libraryId) ||
    genreMatch(genres, movie.genresJson) ||
    yearMatch(decades, movie.year) ||
    (people.size > 0 && matchesPerson(people, parseJson<CastMember[]>(movie.castJson, []), parseJson<string[]>(movie.directorsJson, [])));
  const seriesMatch = (show: SeriesRow) =>
    seriesIds.has(show.id) ||
    libraryIds.has(show.libraryId) ||
    genreMatch(genres, show.genresJson) ||
    yearMatch(decades, show.year) ||
    (people.size > 0 && matchesPerson(people, parseJson<CastMember[]>(show.castJson, []), parseJson<string[]>(show.creatorsJson, [])));

  const { byMovie, byEpisode } = bestFiles();
  const items: ScheduleItem[] = [];

  const chosenMovies = db
    .select()
    .from(movies)
    .all()
    .filter((movie) => byMovie.has(movie.id) && movieMatch(movie))
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (a.sortTitle ?? a.title).localeCompare(b.sortTitle ?? b.title));
  chosenMovies.forEach((movie, index) => {
    const best = byMovie.get(movie.id)!;
    const ms = best.ms ?? (movie.runtime ? movie.runtime * 60_000 : null);
    if (ms == null || ms < MIN_ITEM_MS) return;
    items.push({
      itemType: "movie",
      itemId: movie.id,
      fileId: best.file.id,
      durationMs: ms,
      title: movie.title,
      subtitle: movie.year ? String(movie.year) : null,
      description: movie.overview,
      image: movie.backdropPath ?? movie.posterPath,
      group: "movies",
      order: index,
    });
  });

  const shows = new Map(db.select().from(series).all().filter(seriesMatch).map((show) => [show.id, show]));
  if (shows.size > 0) {
    for (const episode of db.select().from(episodes).all() as EpisodeRow[]) {
      const show = shows.get(episode.seriesId);
      const best = show ? byEpisode.get(episode.id) : undefined;
      if (!show || !best) continue;
      const ms = best.ms ?? (episode.runtime ? episode.runtime * 60_000 : null);
      if (ms == null || ms < MIN_ITEM_MS) continue;
      // Specials (season 0) come after the regular seasons.
      const season = episode.seasonNumber > 0 ? episode.seasonNumber : 9999;
      items.push({
        itemType: "episode",
        itemId: episode.id,
        fileId: best.file.id,
        durationMs: ms,
        title: show.title,
        subtitle: `S${episode.seasonNumber} · E${episode.episodeNumber}${episode.title ? ` · ${episode.title}` : ""}`,
        description: episode.overview ?? show.overview,
        image: episode.stillPath ?? show.backdropPath ?? show.posterPath,
        group: `series:${show.id}`,
        order: season * 10_000 + episode.episodeNumber,
      });
    }
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.fileId)) return false;
    seen.add(item.fileId);
    return true;
  });
}

/** Choices for the channel form, drawn from what the library holds. */
export function channelOptions(): ChannelOptions {
  const movieRows = db.select().from(movies).all();
  const seriesRows = db.select().from(series).all();
  const genres = new Map<string, string>();
  const years = new Set<number>();
  const people = new Map<string, { name: string; count: number }>();
  const countPerson = (name: string) => {
    const shown = latin(name).trim();
    if (!shown) return;
    const entry = people.get(key(shown));
    if (entry) entry.count += 1;
    else people.set(key(shown), { name: shown, count: 1 });
  };
  for (const row of [...movieRows, ...seriesRows]) {
    for (const genre of parseJson<string[]>(row.genresJson, [])) if (!genres.has(key(genre))) genres.set(key(genre), genre);
    if (row.year) years.add(Math.floor(row.year / 10) * 10);
    // Leading roles only: the list would otherwise run to thousands of names.
    for (const member of parseJson<CastMember[]>(row.castJson, []).slice(0, 8)) countPerson(member.name);
  }
  for (const movie of movieRows) for (const name of parseJson<string[]>(movie.directorsJson, [])) countPerson(name);
  for (const show of seriesRows) for (const name of parseJson<string[]>(show.creatorsJson, [])) countPerson(name);
  const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
  const numbers = db.select({ number: channels.number }).from(channels).all().map((row) => row.number);
  return {
    genres: [...genres.values()].sort((a, b) => a.localeCompare(b)),
    series: seriesRows.map((row) => ({ id: row.id, title: row.title, year: row.year })).sort(byTitle),
    movies: movieRows.map((row) => ({ id: row.id, title: row.title, year: row.year })).sort(byTitle),
    libraries: db
      .select()
      .from(libraries)
      .all()
      .filter((library) => library.type !== "music")
      .map((library) => ({ id: library.id, name: library.name, type: library.type as LibraryType })),
    decades: [...years].sort((a, b) => a - b),
    people: [...people.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 400)
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b)),
    nextNumber: numbers.length > 0 ? Math.max(...numbers) + 1 : 1,
  };
}
