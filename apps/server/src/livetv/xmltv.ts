/** A channel listed by an XMLTV guide. */
export interface XmltvChannel {
  id: string;
  names: string[];
}

export interface XmltvProgramme {
  channel: string;
  start: number;
  end: number;
  title: string;
  subtitle: string | null;
  description: string | null;
}

/** An element bigger than this is broken or hostile; it is skipped. */
const MAX_ELEMENT_CHARS = 512 * 1024;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Element text: CDATA kept as written, markup elsewhere dropped, entities decoded. */
export function decodeXmlText(text: string) {
  return text
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) => (part.startsWith("<![CDATA[") ? part.slice(9, -3) : decodeEntities(part.replace(/<[^>]*>/g, ""))))
    .join("")
    .trim();
}

function attribute(tag: string, name: string) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? decodeXmlText(match[1] ?? match[2] ?? "") : null;
}

/** Texts of the child elements `name`, in document order. */
function children(body: string, name: string) {
  const out: { attributes: string; text: string }[] = [];
  const pattern = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi");
  for (const match of body.matchAll(pattern)) {
    const text = decodeXmlText(match[2] ?? "");
    if (text) out.push({ attributes: match[1] ?? "", text });
  }
  return out;
}

/**
 * XMLTV time: "YYYYMMDDhhmmss +hhmm", with the seconds, minutes and zone optional. Without a zone
 * the time is UTC, as the format says.
 */
export function parseXmltvTime(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0", second = "0", zone] = match;
  let time = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (zone && zone !== "Z") {
    const digits = zone.replace(":", "");
    const sign = digits[0] === "-" ? -1 : 1;
    time -= sign * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5))) * 60_000;
  }
  return Number.isFinite(time) ? time : null;
}

/** "S1 · E4" from the onscreen or xmltv_ns numbering, when it reads as one. */
export function episodeLabel(body: string) {
  for (const entry of children(body, "episode-num")) {
    const system = attribute(entry.attributes, "system") ?? "";
    if (system === "xmltv_ns") {
      // "season.episode.part", zero based; either side may be missing or "x/total".
      const [season, episode] = entry.text.split(".").map((part) => {
        const number = Number(part.split("/")[0]!.trim());
        return part.trim() && Number.isInteger(number) ? number + 1 : null;
      });
      if (season != null && episode != null) return `S${season} · E${episode}`;
      if (episode != null) return `E${episode}`;
    } else {
      const onscreen = /S(\d+)\s*[ .:-]?\s*E(\d+)/i.exec(entry.text);
      if (onscreen) return `S${Number(onscreen[1])} · E${Number(onscreen[2])}`;
    }
  }
  return null;
}

function parseChannel(element: string): XmltvChannel | null {
  const open = element.slice(0, element.indexOf(">") + 1);
  const id = attribute(open, "id");
  if (!id) return null;
  return { id, names: children(element, "display-name").map((entry) => entry.text) };
}

function parseProgramme(element: string): XmltvProgramme | null {
  const close = element.indexOf(">");
  const open = element.slice(0, close + 1);
  const body = element.slice(close + 1);
  const channel = attribute(open, "channel");
  const start = parseXmltvTime(attribute(open, "start"));
  const end = parseXmltvTime(attribute(open, "stop"));
  const title = children(body, "title")[0]?.text;
  if (!channel || start == null || !title) return null;
  const episode = episodeLabel(body);
  const subTitle = children(body, "sub-title")[0]?.text ?? null;
  const subtitle = [episode, subTitle].filter(Boolean).join(" · ") || null;
  return {
    channel,
    start,
    // A missing stop time is filled in from the next programme by the caller.
    end: end ?? Number.NaN,
    title: title.slice(0, 300),
    subtitle: subtitle?.slice(0, 300) ?? null,
    description: children(body, "desc")[0]?.text.slice(0, 4000) ?? null,
  };
}

/**
 * Reads an XMLTV document in pieces, so a guide of hundreds of megabytes never sits in memory whole.
 * Only `<channel>` and `<programme>` elements matter; everything else is skipped.
 */
export class XmltvReader {
  private buffer = "";

  constructor(private readonly handlers: { channel?: (channel: XmltvChannel) => void; programme?: (programme: XmltvProgramme) => void }) {}

  push(text: string) {
    this.buffer += text;
    this.drain();
  }

  end() {
    this.drain();
    this.buffer = "";
  }

  private drain() {
    let at = 0;
    for (;;) {
      const next = nextElement(this.buffer, at);
      if (!next) {
        // Keep enough of the tail to recognize an opening tag cut in half.
        at = Math.max(at, this.buffer.length - 16);
        break;
      }
      const closeTag = `</${next.name}>`;
      const openEnd = this.buffer.indexOf(">", next.index);
      if (openEnd < 0) {
        at = next.index;
        if (this.buffer.length - at > MAX_ELEMENT_CHARS) at = this.buffer.length;
        break;
      }
      let endIndex: number;
      if (this.buffer[openEnd - 1] === "/") endIndex = openEnd + 1;
      else {
        const close = this.buffer.indexOf(closeTag, openEnd);
        if (close < 0) {
          at = next.index;
          if (this.buffer.length - at > MAX_ELEMENT_CHARS) at = this.buffer.length;
          break;
        }
        endIndex = close + closeTag.length;
      }
      const element = this.buffer.slice(next.index, endIndex);
      at = endIndex;
      if (next.name === "channel") {
        const channel = parseChannel(element);
        if (channel) this.handlers.channel?.(channel);
      } else {
        const programme = parseProgramme(element);
        if (programme) this.handlers.programme?.(programme);
      }
    }
    this.buffer = this.buffer.slice(at);
  }
}

function nextElement(buffer: string, from: number) {
  const pattern = /<(channel|programme)[\s>/]/g;
  pattern.lastIndex = from;
  const match = pattern.exec(buffer);
  return match ? { index: match.index, name: match[1] as "channel" | "programme" } : null;
}

/** Whole-document convenience for small guides and tests. */
export function parseXmltv(text: string) {
  const channels: XmltvChannel[] = [];
  const programmes: XmltvProgramme[] = [];
  const reader = new XmltvReader({ channel: (channel) => channels.push(channel), programme: (programme) => programmes.push(programme) });
  reader.push(text);
  reader.end();
  return { channels, programmes };
}

/** The encoding named in the XML declaration, if any. */
export function declaredEncoding(head: string) {
  const match = /^﻿?<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * A channel name reduced to what matching should compare: no diacritics, case, punctuation,
 * country prefixes ("RO:", "UK |") or quality tags ("HD", "FHD", "4K").
 */
export function normalizeChannelName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*[a-z]{2,3}\s*[:|\-]\s+/, "")
    .replace(/^\s*[a-z]{2,3}\s*[:|]/, "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(uhd|fhd|hd|sd|hq|4k|8k|1080p?|720p?|hevc|h265|h264|backup|\+1)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Fills in missing stop times from the next programme of the same channel and drops programmes that
 * overlap the one before (guides sometimes list a slot twice). Input order does not matter.
 */
export function tidyProgrammes(programmes: XmltvProgramme[]) {
  const sorted = [...programmes].sort((a, b) => a.start - b.start);
  const out: XmltvProgramme[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const programme = { ...sorted[index]! };
    if (!Number.isFinite(programme.end)) {
      const next = sorted.slice(index + 1).find((entry) => entry.start > programme.start);
      if (!next) continue;
      programme.end = next.start;
    }
    if (programme.end <= programme.start) continue;
    const previous = out[out.length - 1];
    if (previous && programme.start < previous.end) {
      if (programme.end <= previous.end) continue;
      programme.start = previous.end;
    }
    out.push(programme);
  }
  return out;
}

export type EpgMatch = "manual" | "tvg-id" | "name";

/**
 * Lower-case forms of a tvg-id to look up in a guide: as written, then without a feed suffix
 * ("A7TV.ro@SD" → "a7tv.ro"), the way iptv-org playlists name a channel's variants.
 */
export function tvgIdKeys(tvgId: string | null) {
  if (!tvgId) return [];
  const key = tvgId.toLowerCase();
  const bare = key.replace(/@[^@]*$/, "");
  return bare && bare !== key ? [key, bare] : [key];
}

export interface MatchableChannel {
  id: string;
  name: string;
  tvgId: string | null;
  tvgName: string | null;
  /** Chosen by hand; wins over the automatic matches. */
  epgChannel: string | null;
}

/** Guide channel of each playlist channel: the manual choice, then tvg-id, then the name. */
export function matchGuideChannels(channels: MatchableChannel[], guide: XmltvChannel[]) {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const entry of guide) {
    if (!byId.has(entry.id.toLowerCase())) byId.set(entry.id.toLowerCase(), entry.id);
    for (const name of [...entry.names, entry.id]) {
      const key = normalizeChannelName(name);
      if (key && !byName.has(key)) byName.set(key, entry.id);
    }
  }
  const out = new Map<string, { epgId: string; how: EpgMatch }>();
  for (const channel of channels) {
    if (channel.epgChannel) {
      out.set(channel.id, { epgId: channel.epgChannel, how: "manual" });
      continue;
    }
    const byTvg = tvgIdKeys(channel.tvgId).map((key) => byId.get(key)).find(Boolean);
    if (byTvg) {
      out.set(channel.id, { epgId: byTvg, how: "tvg-id" });
      continue;
    }
    for (const name of [channel.name, channel.tvgName]) {
      const key = name ? normalizeChannelName(name) : "";
      const found = key ? byName.get(key) : undefined;
      if (found) {
        out.set(channel.id, { epgId: found, how: "name" });
        break;
      }
    }
  }
  return out;
}
