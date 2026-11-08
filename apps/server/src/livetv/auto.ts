import type { ChannelOrder, ChannelSource } from "@kinora/shared";

/** A genre needs this many titles (movies plus series) for a channel of its own. */
export const AUTO_GENRE_MIN_TITLES = 3;
/** A music genre needs this many tracks. */
export const AUTO_MUSIC_MIN_TRACKS = 15;
export const DEFAULT_SERIES_MIN_EPISODES = 20;
/** Only the largest music genres get a channel; tag genres are many and often tiny. */
export const AUTO_MUSIC_MAX_CHANNELS = 8;
/** Tag values that are not a genre anyone would tune in to. */
const NOT_A_GENRE = /^(other|others|unknown|misc|miscellaneous|general|none|genre|speech|default|various|varios|diverse)$/i;

export interface AutoChannelPlan {
  key: string;
  name: string;
  orderMode: ChannelOrder;
  sources: ChannelSource[];
}

export interface Inventory {
  genres: { name: string; count: number }[];
  series: { id: string; title: string; episodes: number }[];
  musicGenres: { name: string; count: number }[];
}

function byName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name);
}

/** The automatic channels the library calls for, in the order they get numbers: genres, series, music. */
export function planAutoChannels(inventory: Inventory, seriesMinEpisodes: number): AutoChannelPlan[] {
  const genres = inventory.genres
    .filter((genre) => genre.count >= AUTO_GENRE_MIN_TITLES)
    .sort(byName)
    .map((genre) => ({ key: `genre:${genre.name.toLocaleLowerCase()}`, name: genre.name, orderMode: "shuffle" as const, sources: [{ type: "genre" as const, value: genre.name }] }));
  const shows = inventory.series
    .filter((show) => show.episodes >= seriesMinEpisodes)
    .map((show) => ({ key: `series:${show.id}`, name: show.title, orderMode: "sequential" as const, sources: [{ type: "series" as const, value: show.id }] }))
    .sort(byName);
  const music = inventory.musicGenres
    .filter((genre) => genre.count >= AUTO_MUSIC_MIN_TRACKS && !NOT_A_GENRE.test(genre.name.trim()))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, AUTO_MUSIC_MAX_CHANNELS)
    .sort(byName)
    .map((genre) => ({ key: `music:${genre.name.toLocaleLowerCase()}`, name: `${genre.name} ♪`, orderMode: "shuffle" as const, sources: [{ type: "musicGenre" as const, value: genre.name }] }));
  return [...genres, ...shows, ...music];
}

/**
 * Plans to create: not there yet and not dismissed by deleting them. Automatic channels the library
 * no longer calls for are kept (a disconnected drive would otherwise drop and renumber them); with
 * nothing to air they stay out of the guide like any other empty channel.
 */
export function newAutoChannels(plans: AutoChannelPlan[], existingKeys: Set<string>, dismissed: Set<string>) {
  return plans.filter((plan) => !existingKeys.has(plan.key) && !dismissed.has(plan.key));
}
