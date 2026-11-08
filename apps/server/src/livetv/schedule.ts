import type { ChannelOrder } from "@kinora/shared";

/** How far ahead a channel's program is materialized. */
export const HORIZON_MS = 72 * 60 * 60 * 1000;
/** Programs that ended longer ago than this are dropped. */
export const KEEP_PAST_MS = 24 * 60 * 60 * 1000;
/** Shorter items (samples, extras with a broken duration) are not scheduled. */
export const MIN_ITEM_MS = 30_000;
/** Gaps shorter than this before an aligned start are added to the program instead of getting a filler. */
export const MIN_FILLER_MS = 1000;
/** Upper bound for one fill, so a channel of very short items cannot write without end. */
const MAX_FILL = 3000;

/** Something a channel can air: one playable file and what the guide shows for it. */
export interface ScheduleItem {
  itemType: "movie" | "episode" | "track";
  itemId: string;
  fileId: string;
  durationMs: number;
  title: string;
  subtitle: string | null;
  description: string | null;
  image: string | null;
  /** Sequential order rotates between groups (a series, or all movies) and plays each group in order. */
  group: string;
  /** Position inside the group: release order for movies, season and episode for series. */
  order: number;
}

export interface ProgramDraft {
  start: number;
  end: number;
  /** A filler keeps the position of the item before it, so the play order is not affected. */
  seq: number;
  itemType: ScheduleItem["itemType"] | "filler";
  itemId: string | null;
  fileId: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  image: string | null;
}

/** Small seeded generator (mulberry32); the same seed always gives the same sequence. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cycleSeed(seed: number, cycle: number) {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(cycle + 1, 0xc2b2ae35)) >>> 0;
}

function rawPermutation(length: number, seed: number, cycle: number) {
  const order = Array.from({ length }, (_, index) => index);
  const random = seededRandom(cycleSeed(seed, cycle));
  for (let index = length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  return order;
}

/**
 * Play order for one pass over `length` items. Each pass is shuffled on its own, and a pass never
 * starts with the item the previous pass ended on.
 */
export function shuffledOrder(length: number, seed: number, cycle: number) {
  // With one or two items, alternating is the only order without repeats.
  if (length <= 2) return Array.from({ length }, (_, index) => index);
  const order = rawPermutation(length, seed, cycle);
  if (cycle > 0) {
    const previous = rawPermutation(length, seed, cycle - 1);
    if (order[0] === previous[length - 1]) [order[0], order[1]] = [order[1]!, order[0]!];
  }
  return order;
}

/** Items in an order that does not depend on how the database returned them. */
function canonical(items: ScheduleItem[]) {
  return [...items].sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.fileId.localeCompare(b.fileId));
}

/** Picks the item at any position of a channel's endless play order. */
export function createPicker(items: ScheduleItem[], mode: ChannelOrder, seed: number) {
  const sorted = canonical(items.filter((item) => item.durationMs >= MIN_ITEM_MS));
  if (sorted.length === 0) return null;
  if (mode === "shuffle") {
    const cache = new Map<number, number[]>();
    return (seq: number) => {
      const cycle = Math.floor(seq / sorted.length);
      let order = cache.get(cycle);
      if (!order) {
        order = shuffledOrder(sorted.length, seed, cycle);
        cache.set(cycle, order);
      }
      return sorted[order[seq % sorted.length]!]!;
    };
  }
  // Sequential: one turn per group, each group keeps its own place and starts over when it runs out.
  const groups: ScheduleItem[][] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.group === item.group) last.push(item);
    else groups.push([item]);
  }
  return (seq: number) => {
    const group = groups[seq % groups.length]!;
    return group[Math.floor(seq / groups.length) % group.length]!;
  };
}

/** Minutes the server's clock is ahead of UTC at `time`, so a 60-minute grid falls on the local hour. */
export function localOffsetMinutes(time: number) {
  return -new Date(time).getTimezoneOffset();
}

/** The first point of a grid of `minutes` (counted in local time) at or after `time`. */
export function nextSlot(time: number, minutes: number, offsetMinutes = localOffsetMinutes(time)) {
  if (minutes <= 0) return time;
  const step = minutes * 60_000;
  const shift = offsetMinutes * 60_000;
  return Math.ceil((time + shift) / step) * step - shift;
}

function fillerDraft(start: number, end: number, seq: number): ProgramDraft {
  return { start, end, seq, itemType: "filler", itemId: null, fileId: null, title: "", subtitle: null, description: null, image: null };
}

export interface FillInput {
  items: ScheduleItem[];
  mode: ChannelOrder;
  seed: number;
  from: number;
  firstSeq: number;
  until: number;
  /** Start every item on this grid, with a filler before it; 0 lays items end to end. */
  alignMinutes?: number;
  /** Align the first item too (the fill continues an existing program); otherwise it starts at `from`. */
  alignFirst?: boolean;
  offsetMinutes?: number;
}

/**
 * Programs laid end to end from `from` until `until`, starting at position `firstSeq` of the play order.
 * With `alignMinutes`, each item starts on the grid and a filler program covers the gap before it.
 */
export function fillSchedule(input: FillInput) {
  const pick = createPicker(input.items, input.mode, input.seed);
  const programs: ProgramDraft[] = [];
  if (!pick) return programs;
  const align = input.alignMinutes ?? 0;
  const slot = (time: number) => nextSlot(time, align, input.offsetMinutes);
  let start = input.from;
  let seq = input.firstSeq;
  let alignNext = align > 0 && input.alignFirst === true;
  while (start < input.until && programs.length < MAX_FILL) {
    if (alignNext) {
      const aligned = slot(start);
      if (aligned - start >= MIN_FILLER_MS) {
        programs.push(fillerDraft(start, aligned, seq - 1));
      } else if (aligned > start) {
        // A sliver of a gap goes to the program before it.
        const previous = programs[programs.length - 1];
        if (previous) previous.end = aligned;
      }
      start = aligned;
      if (start >= input.until) break;
    }
    alignNext = align > 0;
    const item = pick(seq);
    const end = start + item.durationMs;
    programs.push({
      start,
      end,
      seq,
      itemType: item.itemType,
      itemId: item.itemId,
      fileId: item.fileId,
      title: item.title,
      subtitle: item.subtitle,
      description: item.description,
      image: item.image,
    });
    start = end;
    seq += 1;
  }
  return programs;
}

export interface ExistingProgram {
  start: number;
  end: number;
  seq: number;
}

/**
 * What to change in a channel's stored program so it reaches `now + horizon`.
 *
 * - Without `cutAt`, the program is only extended after its last entry (or from now, when it ran out).
 * - With `cutAt`, entries starting at or after it are dropped and rebuilt. The program airing at
 *   `cutAt` is kept when `cutAt` is now (a channel edit should not interrupt the viewer); a cut in the
 *   past (a missing file found while it airs) rebuilds from that point.
 *
 * The play order continues from the last kept entry, so extending in steps gives the same program as
 * filling it at once.
 */
export function continueSchedule(input: {
  existing: ExistingProgram[];
  items: ScheduleItem[];
  mode: ChannelOrder;
  seed: number;
  now: number;
  horizonMs?: number;
  cutAt?: number | null;
  alignMinutes?: number;
  offsetMinutes?: number;
}) {
  const cutAt = input.cutAt ?? null;
  const now = Math.floor(input.now / 1000) * 1000;
  const kept = [...input.existing].sort((a, b) => a.start - b.start).filter((program) => cutAt == null || program.start < cutAt);
  const last = kept[kept.length - 1];
  const base = last ? last.end : Number.NEGATIVE_INFINITY;
  const from = cutAt == null ? Math.max(base, now) : Math.max(base, Math.min(cutAt, now));
  const add = fillSchedule({
    items: input.items,
    mode: input.mode,
    seed: input.seed,
    from,
    firstSeq: last ? last.seq + 1 : 0,
    until: now + (input.horizonMs ?? HORIZON_MS),
    alignMinutes: input.alignMinutes,
    // A new channel starts at once; a program that carries on waits for the next slot.
    alignFirst: from === base,
    offsetMinutes: input.offsetMinutes,
  });
  return { removeFrom: cutAt, add };
}
