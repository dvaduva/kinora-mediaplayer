/**
 * Pre-transcoding for Live TV: a few minutes before the next program of a channel someone is watching
 * starts, its file is converted in the background, so the change of program does not wait for ffmpeg.
 */

/** A channel counts as watched while its player checked in this recently. */
export const WATCH_TTL_MS = 90_000;
/** How long before a program starts its conversion begins. */
export const PREPARE_BEFORE_MS = 5 * 60_000;
/**
 * While a player's own conversion still runs, the next one waits until this close to its start, so two
 * encoders share the processor only briefly.
 */
export const SHARE_CPU_BEFORE_MS = 90_000;
/** A prepared conversion stays open this long after its program started, until the player picks it up. */
export const PICKUP_GRACE_MS = 60_000;

const watchers = new Map<string, number>();

export function markWatching(channelId: string, now = Date.now()) {
  watchers.set(channelId, now);
}

export function stopWatching(channelId: string) {
  watchers.delete(channelId);
}

export function watchedChannels(now = Date.now()) {
  const ids: string[] = [];
  for (const [id, seen] of watchers) {
    if (now - seen <= WATCH_TTL_MS) ids.push(id);
    else watchers.delete(id);
  }
  return ids;
}

export interface UpcomingProgram {
  channelId: string;
  start: number;
  fileId: string;
}

export interface PrepareDecision {
  /** The program to convert now, if any. */
  start: UpcomingProgram | null;
  /** Files whose background conversion is still wanted; the others are stopped. */
  keep: Set<string>;
}

/**
 * Picks what to prepare: the soonest upcoming program (of the watched channels) starting within
 * PREPARE_BEFORE_MS. `recent` are programs that started a moment ago, kept for their player to join.
 * While another conversion runs, waiting is preferred until SHARE_CPU_BEFORE_MS.
 */
export function decidePrepare(input: { now: number; upcoming: UpcomingProgram[]; recent: UpcomingProgram[]; foregroundBusy: boolean }): PrepareDecision {
  const keep = new Set<string>();
  for (const program of input.recent) if (input.now - program.start <= PICKUP_GRACE_MS) keep.add(program.fileId);
  const due = input.upcoming
    .filter((program) => program.start > input.now && program.start - input.now <= PREPARE_BEFORE_MS)
    .sort((a, b) => a.start - b.start);
  for (const program of due) keep.add(program.fileId);
  const first = due[0] ?? null;
  if (!first) return { start: null, keep };
  if (input.foregroundBusy && first.start - input.now > SHARE_CPU_BEFORE_MS) return { start: null, keep };
  return { start: first, keep };
}
