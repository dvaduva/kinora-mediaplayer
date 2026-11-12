import { useEffect, useState } from "react";
import { CATEGORY_MOVIES, CATEGORY_MUSIC, CATEGORY_SERIES, channelColor, channelInitials, type ChannelProgram, type LiveChannel } from "@kinora/shared";
import { api } from "./api";
import type { Locale } from "./format";

/** The copy the Live TV helpers read; each app's full `Copy` satisfies it. */
export type LiveTvCopy = {
  liveFillerTitle: string;
  liveCategoryMovies: string;
  liveCategorySeries: string;
  liveCategoryMusic: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * An uploaded logo, or the channel's initials on a color derived from its name.
 * `resolveSrc` turns the stored logo URL into the one to load (identity when left out).
 */
export function ChannelLogo(props: { channel: Pick<LiveChannel, "name" | "logoUrl">; className?: string; resolveSrc?: (url: string) => string }) {
  const { channel } = props;
  const className = `channel-logo${props.className ? ` ${props.className}` : ""}`;
  if (channel.logoUrl) {
    return (
      <span className={`${className} has-image`}>
        <img src={props.resolveSrc ? props.resolveSrc(channel.logoUrl) : channel.logoUrl} alt="" decoding="async" />
      </span>
    );
  }
  return (
    <span className={className} style={{ background: channelColor(channel.name) }} aria-hidden="true">
      {channelInitials(channel.name)}
    </span>
  );
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: Locale, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}${JSON.stringify(options)}`;
  let value = formatters.get(key);
  if (!value) {
    value = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", options);
    formatters.set(key, value);
  }
  return value;
}

/** "21:45" */
export function clockTime(ms: number, locale: Locale) {
  return formatter(locale, { hour: "2-digit", minute: "2-digit" }).format(ms);
}

/** "Lu, 9 nov." */
export function dayLabel(ms: number, locale: Locale) {
  return formatter(locale, { weekday: "short", day: "numeric", month: "short" }).format(ms);
}

export function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function nextMidnight(day: number) {
  const date = new Date(day);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

/** Midnight of each day the 72-hour program reaches, today first. */
export function guideDays(now: number) {
  const days: number[] = [];
  const first = startOfDay(now);
  for (let index = 0; index < 4; index += 1) {
    const date = new Date(first);
    date.setDate(date.getDate() + index);
    if (date.getTime() < now + 72 * HOUR) days.push(date.getTime());
  }
  return days;
}

/**
 * The server's clock as seen from here: the browser's time corrected by the offset measured on the
 * last response, so "now" in the guide matches the schedule even if this device's clock drifts.
 */
let skew = 0;
export function syncClock(serverNow: number, sentAt: number, receivedAt = Date.now()) {
  skew = serverNow - (sentAt + receivedAt) / 2;
}

export function serverNow() {
  return Date.now() + skew;
}

/** Re-renders every `everyMs` and returns the server time. */
export function useNow(everyMs = 15_000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** The gap before an aligned start: no title of its own, it leads into the next program. */
export function isFiller(program: Pick<ChannelProgram, "itemType"> | null | undefined) {
  return program?.itemType === "filler";
}

export function programTitle(program: Pick<ChannelProgram, "itemType" | "title">, t: Pick<LiveTvCopy, "liveFillerTitle">) {
  return isFiller(program) ? t.liveFillerTitle : program.title;
}

/** What airs at `now` in a channel's sorted programs, and the next real program after it. */
export function currentAndNext<T extends Pick<ChannelProgram, "start" | "end" | "itemType">>(list: T[], now: number) {
  const current = list.find((program) => program.start <= now && now < program.end) ?? null;
  const next = list.find((program) => program.start >= (current?.end ?? now) && !isFiller(program)) ?? null;
  return { current, next };
}

export function programProgress(program: { start: number; end: number }, now: number) {
  if (program.end <= program.start) return 0;
  return Math.max(0, Math.min(1, (now - program.start) / (program.end - program.start)));
}

export function programSeconds(program: Pick<ChannelProgram, "start" | "end"> | null) {
  return program ? (program.end - program.start) / 1000 : 0;
}

/** Seconds into the program that are airing at `now`. */
export function liveSeconds(program: Pick<ChannelProgram, "start" | "end"> | null, now: number) {
  return program ? Math.min(programSeconds(program), Math.max(0, (now - program.start) / 1000)) : 0;
}

/** Programs grouped by channel id, in the order they came. */
export function byChannel<T extends Pick<ChannelProgram, "channelId">>(programs: T[]) {
  const map = new Map<string, T[]>();
  for (const program of programs) {
    const list = map.get(program.channelId);
    if (list) list.push(program);
    else map.set(program.channelId, [program]);
  }
  return map;
}

/** A category as people read it: the kind tokens translated, genres and overrides as they are. */
export function categoryLabel(category: string, t: Omit<LiveTvCopy, "liveFillerTitle">) {
  if (category === CATEGORY_MOVIES) return t.liveCategoryMovies;
  if (category === CATEGORY_SERIES) return t.liveCategorySeries;
  if (category === CATEGORY_MUSIC) return t.liveCategoryMusic;
  return category;
}

/** "favorites", "all", or a category value. */
export type ChannelFilter = { kind: "favorites" } | { kind: "all" } | { kind: "category"; value: string };

export function filterChannels<T extends Pick<LiveChannel, "favorite" | "category">>(channels: T[], filter: ChannelFilter) {
  if (filter.kind === "favorites") return channels.filter((channel) => channel.favorite);
  if (filter.kind === "category") return channels.filter((channel) => channel.category === filter.value);
  return channels;
}

/** Categories with at least one channel, by name. */
export function channelCategories(channels: Pick<LiveChannel, "category">[], t: Omit<LiveTvCopy, "liveFillerTitle">) {
  // filter + map rather than flatMap: the TV UI also runs on Chromium 68 (webOS 5), which lacks flatMap.
  const values = [...new Set(channels.map((channel) => channel.category).filter((category): category is string => Boolean(category)))];
  return values.sort((a, b) => categoryLabel(a, t).localeCompare(categoryLabel(b, t)));
}

/** Applies a filter that still makes sense for these channels; a category that emptied shows All. */
export function effectiveFilter(filter: ChannelFilter, channels: Pick<LiveChannel, "category">[]): ChannelFilter {
  if (filter.kind === "category" && !channels.some((channel) => channel.category === filter.value)) return { kind: "all" };
  return filter;
}

/** Whether two filters pick the same tab. */
export function sameFilter(a: ChannelFilter, b: ChannelFilter) {
  return a.kind === b.kind && (a.kind !== "category" || (b.kind === "category" && b.value === a.value));
}

/** The filter remembered under `storageKey`, or "All". */
export function readChannelFilter(storageKey: string): ChannelFilter {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (parsed && typeof parsed === "object" && "kind" in parsed) {
      const value = parsed as ChannelFilter;
      if (value.kind === "favorites" || value.kind === "all") return { kind: value.kind };
      if (value.kind === "category" && typeof value.value === "string") return value;
    }
  } catch {
    // Storage may be blocked; start on "All".
  }
  return { kind: "all" };
}

export function saveChannelFilter(storageKey: string, filter: ChannelFilter) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(filter));
  } catch {
    // Not remembered, still applied.
  }
}

/** The tab picked last on this device, remembered under `storageKey`. */
export function useChannelFilter(storageKey: string) {
  const [filter, setFilter] = useState<ChannelFilter>(() => readChannelFilter(storageKey));
  const change = (next: ChannelFilter) => {
    setFilter(next);
    saveChannelFilter(storageKey, next);
  };
  return [filter, change] as const;
}

/** The guide's two views. */
export type GuideTab = "guide" | "whatson";

export function readGuideTab(storageKey: string): GuideTab {
  try {
    return window.localStorage.getItem(storageKey) === "whatson" ? "whatson" : "guide";
  } catch {
    return "guide";
  }
}

export function saveGuideTab(storageKey: string, tab: GuideTab) {
  try {
    window.localStorage.setItem(storageKey, tab);
  } catch {
    // Only remembered when storage works.
  }
}

export function saveFavorite(channelId: string, favorite: boolean) {
  return api<LiveChannel>(`/api/livetv/channels/${channelId}/favorite`, { method: "PUT", body: JSON.stringify({ favorite }) });
}
