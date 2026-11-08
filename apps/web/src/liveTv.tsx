import { useEffect, useState } from "react";
import { CATEGORY_MOVIES, CATEGORY_MUSIC, CATEGORY_SERIES, channelColor, channelInitials, type LiveChannel } from "@kinora/shared";
import { api } from "./api";
import type { Copy, Locale } from "./i18n";
import { Icon } from "./ui";

/** An uploaded logo, or the channel's initials on a color derived from its name. */
export function ChannelLogo(props: { channel: Pick<LiveChannel, "name" | "logoUrl">; className?: string }) {
  const { channel } = props;
  const className = `channel-logo${props.className ? ` ${props.className}` : ""}`;
  if (channel.logoUrl) {
    return (
      <span className={`${className} has-image`}>
        <img src={channel.logoUrl} alt="" decoding="async" />
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

export function programProgress(program: { start: number; end: number }, now: number) {
  if (program.end <= program.start) return 0;
  return Math.max(0, Math.min(1, (now - program.start) / (program.end - program.start)));
}

/** A category as people read it: the kind tokens translated, genres and overrides as they are. */
export function categoryLabel(category: string, t: Copy) {
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
export function channelCategories(channels: Pick<LiveChannel, "category">[], t: Copy) {
  const values = [...new Set(channels.flatMap((channel) => (channel.category ? [channel.category] : [])))];
  return values.sort((a, b) => categoryLabel(a, t).localeCompare(categoryLabel(b, t)));
}

const FILTER_KEY = "kinora.liveFilter";

function readFilter(): ChannelFilter {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FILTER_KEY) ?? "null");
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

/** The tab picked last on this device. */
export function useChannelFilter() {
  const [filter, setFilter] = useState<ChannelFilter>(readFilter);
  const change = (next: ChannelFilter) => {
    setFilter(next);
    try {
      window.localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {
      // Not remembered, still applied.
    }
  };
  return [filter, change] as const;
}

/** Favorites, All and the categories in use; a remembered category that has no channels left falls back to All. */
export function CategoryBar(props: { channels: Pick<LiveChannel, "category">[]; filter: ChannelFilter; onChange: (filter: ChannelFilter) => void; t: Copy }) {
  const { t, filter } = props;
  const categories = channelCategories(props.channels, t);
  const is = (other: ChannelFilter) => other.kind === filter.kind && (other.kind !== "category" || (filter.kind === "category" && filter.value === other.value));
  const tabs: { filter: ChannelFilter; label: string }[] = [
    { filter: { kind: "favorites" }, label: t.liveFavorites },
    { filter: { kind: "all" }, label: t.liveAll },
    ...categories.map((value) => ({ filter: { kind: "category", value } as ChannelFilter, label: categoryLabel(value, t) })),
  ];
  return (
    <div className="live-categories" role="group" aria-label={t.liveCategories}>
      {tabs.map((tab) => (
        <button key={tab.filter.kind === "category" ? `c:${tab.filter.value}` : tab.filter.kind} type="button" className={is(tab.filter) ? "active" : undefined} aria-pressed={is(tab.filter)} onClick={() => props.onChange(tab.filter)}>
          {tab.filter.kind === "favorites" ? <Icon name="star" /> : null}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Applies a filter that still makes sense for these channels; a category that emptied shows All. */
export function effectiveFilter(filter: ChannelFilter, channels: Pick<LiveChannel, "category">[]): ChannelFilter {
  if (filter.kind === "category" && !channels.some((channel) => channel.category === filter.value)) return { kind: "all" };
  return filter;
}

export function saveFavorite(channelId: string, favorite: boolean) {
  return api<LiveChannel>(`/api/livetv/channels/${channelId}/favorite`, { method: "PUT", body: JSON.stringify({ favorite }) });
}

/** Star toggle; `onChange` gets the new state at once and again with the server's answer. */
export function FavoriteButton(props: { channel: Pick<LiveChannel, "id" | "favorite" | "name">; t: Copy; onChange: (favorite: boolean) => void; className?: string }) {
  const { channel, t } = props;
  const label = channel.favorite ? t.liveFavoriteRemove : t.liveFavoriteAdd;
  return (
    <button
      type="button"
      className={`favorite-button${channel.favorite ? " on" : ""}${props.className ? ` ${props.className}` : ""}`}
      aria-pressed={channel.favorite}
      aria-label={`${label}: ${channel.name}`}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = !channel.favorite;
        props.onChange(next);
        saveFavorite(channel.id, next)
          .then((saved) => props.onChange(saved.favorite))
          .catch(() => props.onChange(!next));
      }}
    >
      <Icon name="star" />
    </button>
  );
}
