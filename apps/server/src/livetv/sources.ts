import type { AudioStream, CastMember, ChannelOptions, ChannelSource, LibraryType } from "@kinora/shared";
import { eq } from "drizzle-orm";
import { db, parseJson } from "../db/index.js";
import { albums, artists, channels, episodes, libraries, mediaFiles, movies, series, tracks } from "../db/schema.js";
import { isNonLatinName, transliterateName } from "../metadata/tmdb.js";
import { playbackPlan } from "../playback/plan.js";
import { tools } from "../process.js";
import { MIN_ITEM_MS, type ScheduleItem } from "./schedule.js";

type MovieRow = typeof movies.$inferSelect;
type SeriesRow = typeof series.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;
type FileRow = typeof mediaFiles.$inferSelect;
type Best = { file: FileRow; ms: number | null };

function latin(name: string) {
  return isNonLatinName(name) ? transliterateName(name) : name;
}

function key(text: string) {
  return text.trim().toLocaleLowerCase();
}

/** Best present file the browser can play (directly or after conversion), with its duration in ms. */
function bestFiles(): { byMovie: Map<string, Best>; byEpisode: Map<string, Best>; byTrack: Map<string, Best> } {
  const byMovie = new Map<string, Best & { score: number }>();
  const byEpisode = new Map<string, Best & { score: number }>();
  const byTrack = new Map<string, Best & { score: number }>();
  for (const file of db.select().from(mediaFiles).where(eq(mediaFiles.missing, false)).all()) {
    if (!file.movieId && !file.episodeId && !file.trackId) continue;
    const audio = parseJson<AudioStream[]>(file.audioJson, []);
    const plan = playbackPlan({
      missing: file.missing,
      kind: file.trackId && !file.movieId && !file.episodeId ? "audio" : "video",
      container: file.container,
      videoCodec: file.videoCodec,
      audioCodec: audio[0]?.codec ?? null,
      ffmpeg: tools.ffmpeg,
    });
    if (!plan.available) continue;
    // Prefer files that play directly, then the larger picture.
    const score = (plan.mode === "direct" ? 1e12 : 0) + (file.width ?? 0) * (file.height ?? 0);
    const entry = { file, ms: file.duration && file.duration > 0 ? Math.round(file.duration) * 1000 : null, score };
    const map = file.movieId ? byMovie : file.episodeId ? byEpisode : byTrack;
    const id = (file.movieId ?? file.episodeId ?? file.trackId)!;
    const current = map.get(id);
    if (!current || score > current.score) map.set(id, entry);
  }
  return { byMovie, byEpisode, byTrack };
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
  const artistIds = new Set(values("artist"));
  const albumIds = new Set(values("album"));
  const musicGenres = new Set(values("musicGenre").map(key));

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

  const { byMovie, byEpisode, byTrack } = bestFiles();
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

  if (artistIds.size > 0 || albumIds.size > 0 || musicGenres.size > 0 || libraryIds.size > 0) {
    items.push(...musicItems(byTrack, { artistIds, albumIds, genres: musicGenres, libraryIds }));
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.fileId)) return false;
    seen.add(item.fileId);
    return true;
  });
}

/**
 * Tracks matching the music rules. Sequential order plays the albums through, one after another
 * (by artist, then year), so the whole selection is one group.
 */
function musicItems(
  byTrack: Map<string, Best>,
  rules: { artistIds: Set<string>; albumIds: Set<string>; genres: Set<string>; libraryIds: Set<string> },
): ScheduleItem[] {
  const { artistIds, albumIds, genres, libraryIds } = rules;
  const artistNames = new Map(db.select({ id: artists.id, name: artists.name }).from(artists).all().map((row) => [row.id, row.name]));
  const albumRows = new Map(db.select().from(albums).all().map((row) => [row.id, row]));
  const albumOrder = [...albumRows.values()]
    .sort(
      (a, b) =>
        (artistNames.get(a.artistId) ?? "").localeCompare(artistNames.get(b.artistId) ?? "") ||
        (a.year ?? 9999) - (b.year ?? 9999) ||
        a.title.localeCompare(b.title),
    )
    .map((row) => row.id);
  const albumIndex = new Map(albumOrder.map((id, index) => [id, index]));
  const items: ScheduleItem[] = [];
  for (const track of db.select().from(tracks).all()) {
    const album = albumRows.get(track.albumId);
    const best = byTrack.get(track.id);
    if (!album || !best) continue;
    const matches =
      libraryIds.has(album.libraryId) ||
      albumIds.has(album.id) || artistIds.has(album.artistId) || (track.genre ? genres.has(key(track.genre)) : false);
    if (!matches) continue;
    const ms = best.ms ?? (track.duration ? Math.round(track.duration * 1000) : null);
    if (ms == null || ms < MIN_ITEM_MS) continue;
    const artist = track.artistName || artistNames.get(album.artistId) || "";
    items.push({
      itemType: "track",
      itemId: track.id,
      fileId: best.file.id,
      durationMs: ms,
      title: track.title,
      subtitle: [artist, album.title].filter(Boolean).join(" · ") || null,
      description: null,
      image: album.coverPath,
      group: "music",
      order: (albumIndex.get(album.id) ?? 0) * 100_000 + (track.discNumber ?? 1) * 1000 + (track.trackNumber ?? 0),
    });
  }
  return items;
}

/** Library type of each library, for deriving categories from library rules. */
export function libraryTypes() {
  return new Map(db.select({ id: libraries.id, type: libraries.type }).from(libraries).all().map((row) => [row.id, row.type as LibraryType]));
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
  const artistRows = db.select({ id: artists.id, name: artists.name }).from(artists).all();
  const artistName = new Map(artistRows.map((row) => [row.id, row.name]));
  const musicGenres = new Map<string, string>();
  for (const row of db.select({ genre: tracks.genre }).from(tracks).all()) {
    if (row.genre && !musicGenres.has(key(row.genre))) musicGenres.set(key(row.genre), row.genre);
  }
  const categories = new Set<string>();
  for (const row of db.select({ category: channels.categoryOverride }).from(channels).all()) if (row.category) categories.add(row.category);
  return {
    genres: [...genres.values()].sort((a, b) => a.localeCompare(b)),
    series: seriesRows.map((row) => ({ id: row.id, title: row.title, year: row.year })).sort(byTitle),
    movies: movieRows.map((row) => ({ id: row.id, title: row.title, year: row.year })).sort(byTitle),
    libraries: db
      .select()
      .from(libraries)
      .all()
      .map((library) => ({ id: library.id, name: library.name, type: library.type as LibraryType })),
    decades: [...years].sort((a, b) => a - b),
    people: [...people.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 400)
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b)),
    artists: artistRows.sort((a, b) => a.name.localeCompare(b.name)),
    albums: db
      .select()
      .from(albums)
      .all()
      .map((row) => ({ id: row.id, title: row.title, artist: artistName.get(row.artistId) ?? "", year: row.year }))
      .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)),
    musicGenres: [...musicGenres.values()].sort((a, b) => a.localeCompare(b)),
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
    nextNumber: numbers.length > 0 ? Math.max(...numbers) + 1 : 1,
  };
}

/** What the library holds that can air, counted the way automatic channels need it. */
export function libraryInventory() {
  const { byMovie, byEpisode, byTrack } = bestFiles();
  const genres = new Map<string, { name: string; count: number }>();
  const countGenres = (json: string) => {
    for (const genre of parseJson<string[]>(json, [])) {
      const entry = genres.get(key(genre));
      if (entry) entry.count += 1;
      else genres.set(key(genre), { name: genre, count: 1 });
    }
  };
  for (const movie of db.select().from(movies).all()) if (byMovie.has(movie.id)) countGenres(movie.genresJson);
  const episodesOf = new Map<string, number>();
  for (const episode of db.select({ id: episodes.id, seriesId: episodes.seriesId }).from(episodes).all()) {
    if (byEpisode.has(episode.id)) episodesOf.set(episode.seriesId, (episodesOf.get(episode.seriesId) ?? 0) + 1);
  }
  const shows: { id: string; title: string; episodes: number }[] = [];
  for (const show of db.select().from(series).all()) {
    const count = episodesOf.get(show.id) ?? 0;
    if (count === 0) continue;
    countGenres(show.genresJson);
    shows.push({ id: show.id, title: show.title, episodes: count });
  }
  const musicGenres = new Map<string, { name: string; count: number }>();
  for (const track of db.select({ id: tracks.id, genre: tracks.genre }).from(tracks).all()) {
    if (!track.genre || !byTrack.has(track.id)) continue;
    const entry = musicGenres.get(key(track.genre));
    if (entry) entry.count += 1;
    else musicGenres.set(key(track.genre), { name: track.genre, count: 1 });
  }
  return { genres: [...genres.values()], series: shows, musicGenres: [...musicGenres.values()] };
}
