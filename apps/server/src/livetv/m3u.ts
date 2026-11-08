/** One channel of an M3U playlist. */
export interface M3uEntry {
  name: string;
  url: string;
  tvgId: string | null;
  tvgName: string | null;
  tvgLogo: string | null;
  /** tvg-chno, when it is a whole number. */
  number: number | null;
  group: string | null;
}

export interface M3uPlaylist {
  /** Guide address announced in the header (url-tvg / x-tvg-url); the first one when several are listed. */
  epgUrl: string | null;
  entries: M3uEntry[];
}

/** Stream addresses ffmpeg may open. Anything else (file:, data:, concat:…) is dropped. */
const STREAM_SCHEMES = /^(https?|rtmps?|rtsp|rtp|udp|mms|mmsh):\/\//i;

export function isStreamUrl(url: string) {
  return STREAM_SCHEMES.test(url) && url.length <= 4000;
}

/** key="value" pairs of an #EXTINF or #EXTM3U line; values may also be unquoted. */
export function m3uAttributes(text: string) {
  const attributes = new Map<string, string>();
  const pattern = /([A-Za-z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,"']+))/g;
  for (const match of text.matchAll(pattern)) {
    attributes.set(match[1]!.toLowerCase(), (match[2] ?? match[3] ?? match[4] ?? "").trim());
  }
  return attributes;
}

/** The display name after the attribute list: the text after the first comma outside quotes. */
function extinfTitle(line: string) {
  let quote: string | null = null;
  for (let index = "#EXTINF:".length; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ",") return { attributes: line.slice("#EXTINF:".length, index), title: line.slice(index + 1).trim() };
  }
  return { attributes: line.slice("#EXTINF:".length), title: "" };
}

/** A channel name without trailing notes like "(1080p)", "[Not 24/7]" or "[Geo-blocked]". */
export function cleanName(name: string) {
  let out = name.trim();
  for (;;) {
    const next = out.replace(/\s*(\(\d{3,4}[pi]\)|\[[^\]]*\])\s*$/i, "").trim();
    if (next === out || !next) return out;
    out = next;
  }
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function channelNumber(value: string | undefined) {
  if (!value || !/^\d{1,4}$/.test(value.trim())) return null;
  const number = Number(value.trim());
  return number >= 1 && number <= 9999 ? number : null;
}

/** Reads an extended M3U playlist. Entries without a usable stream address are skipped. */
export function parseM3u(text: string): M3uPlaylist {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let epgUrl: string | null = null;
  const entries: M3uEntry[] = [];
  let pending: { title: string; attributes: Map<string, string>; group: string | null } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTM3U/i.test(line)) {
      const header = m3uAttributes(line);
      const announced = header.get("url-tvg") ?? header.get("x-tvg-url") ?? header.get("tvg-url");
      const first = announced?.split(",").map((part) => part.trim()).find((part) => /^https?:\/\//i.test(part));
      if (first && !epgUrl) epgUrl = first;
      continue;
    }
    if (/^#EXTINF:/i.test(line)) {
      const { attributes, title } = extinfTitle(line);
      pending = { title, attributes: m3uAttributes(attributes), group: null };
      continue;
    }
    if (/^#EXTGRP:/i.test(line)) {
      if (pending) pending.group = nonEmpty(line.slice("#EXTGRP:".length));
      continue;
    }
    if (line.startsWith("#")) continue;
    // A stream address; without an #EXTINF before it there is no name to show.
    const entry = pending;
    pending = null;
    if (!entry || !isStreamUrl(line)) continue;
    const tvgName = nonEmpty(entry.attributes.get("tvg-name"));
    const name = cleanName(entry.title || tvgName || "").slice(0, 60).trim();
    if (!name) continue;
    entries.push({
      name,
      url: line,
      tvgId: nonEmpty(entry.attributes.get("tvg-id")),
      tvgName,
      tvgLogo: (() => {
        const logo = nonEmpty(entry.attributes.get("tvg-logo"));
        return logo && /^https?:\/\//i.test(logo) ? logo : null;
      })(),
      number: channelNumber(entry.attributes.get("tvg-chno") ?? entry.attributes.get("channel-number")),
      group: nonEmpty(entry.attributes.get("group-title")) ?? entry.group,
    });
  }
  return { epgUrl, entries };
}

/**
 * A key that recognizes an entry on the next refresh, even when the provider changes the stream
 * address (tokens often rotate). Repeated keys get a counter.
 */
export function entryKeys(entries: Pick<M3uEntry, "tvgId" | "name">[]) {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = `${(entry.tvgId ?? "").toLowerCase()}|${entry.name.toLowerCase()}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}#${count}`;
  });
}

/** Numbers for new channels: the playlist's own when free, otherwise the next free ones after all others. */
export function assignNumbers(entries: { number: number | null }[], taken: Set<number>) {
  const used = new Set(taken);
  const out: (number | null)[] = entries.map((entry) => {
    if (entry.number != null && !used.has(entry.number)) {
      used.add(entry.number);
      return entry.number;
    }
    return null;
  });
  let cursor = Math.max(0, ...used);
  return out.map((number) => {
    if (number != null) return number;
    while (used.has(cursor + 1)) cursor += 1;
    if (cursor >= 9999) return null;
    cursor += 1;
    used.add(cursor);
    return cursor;
  });
}
