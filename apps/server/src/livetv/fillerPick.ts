import type { LiveFiller } from "@kinora/shared";
import { seededRandom } from "./schedule.js";

export type FillerVideo = LiveFiller["videos"][number];
/** A trailer with the movie or series it belongs to. */
export type TitleTrailer = FillerVideo & { titleId: string };

/** Most clips sent for one filler; the player starts over if the gap outlasts them. */
const MAX_VIDEOS = 30;
/** A trailer or clip lasts about this long, for sizing the list. */
const TYPICAL_VIDEO_SECONDS = 150;

function shuffled<T>(list: T[], seed: number) {
  const out = [...list];
  const random = seededRandom(seed);
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap]!, out[index]!];
  }
  return out;
}

/**
 * Picks the clips of one filler: for a video channel, trailers of its own titles first, then of the rest
 * of the library, then music videos; a music channel starts with music videos. The same filler always
 * gets the same list.
 */
export function pickFillerVideos(input: {
  trailers: TitleTrailer[];
  clips: FillerVideo[];
  ownTitles: Set<string>;
  music: boolean;
  seed: number;
  seconds: number;
}) {
  const own = input.trailers.filter((video) => input.ownTitles.has(video.titleId));
  const other = input.trailers.filter((video) => !input.ownTitles.has(video.titleId));
  const ordered = input.music
    ? [...shuffled(input.clips, input.seed), ...shuffled(own, input.seed + 1), ...shuffled(other, input.seed + 2)]
    : [...shuffled(own, input.seed), ...shuffled(other, input.seed + 1), ...shuffled(input.clips, input.seed + 2)];
  const wanted = Math.min(MAX_VIDEOS, Math.max(1, Math.ceil(input.seconds / TYPICAL_VIDEO_SECONDS) + 2));
  return ordered.slice(0, wanted).map(({ key, title, kind }) => ({ key, title, kind }));
}

