import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import iconv from "iconv-lite";
import type { GuideChannelOption, IptvSource, IptvSourceInput, IptvSourceStatus } from "@kinora/shared";
import { IPTV_PRESETS } from "@kinora/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { channelPrograms, channels, iptvEpgChannels, iptvSources } from "../db/schema.js";
import { dataDir } from "../paths.js";
import { assignNumbers, entryKeys, parseM3u, type M3uEntry } from "./m3u.js";
import { stopRelay } from "./relay.js";
import { HORIZON_MS, KEEP_PAST_MS } from "./schedule.js";
import { declaredEncoding, matchGuideChannels, tvgIdKeys, tidyProgrammes, XmltvReader, type EpgMatch, type XmltvChannel, type XmltvProgramme } from "./xmltv.js";

type SourceRow = typeof iptvSources.$inferSelect;

export class IptvError extends Error {}

/** Sources are refreshed this often, plus on demand. */
export const REFRESH_EVERY_MS = 12 * 60 * 60 * 1000;
const MAX_PLAYLIST_BYTES = 64 * 1024 * 1024;
const MAX_GUIDE_BYTES = 512 * 1024 * 1024;
/** Decompressed guides can be far larger than the download. */
const MAX_GUIDE_TEXT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CHANNELS_PER_SOURCE = 5000;
const MAX_GUIDE_CHANNELS = 20_000;
const PLAYLIST_TIMEOUT_MS = 60_000;
const GUIDE_TIMEOUT_MS = 5 * 60_000;
const USER_AGENT = "Kinora/1.0";

const guideDir = path.join(dataDir, "cache", "iptv-epg");
const remoteLogoDir = path.join(dataDir, "channel-logos", "remote");

function chunks<T>(list: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

function guideFile(sourceId: string) {
  return path.join(guideDir, `${sourceId.replace(/[^\w-]/g, "_")}.xmltv`);
}

/* Sources ------------------------------------------------------------------- */

function sourceDto(row: SourceRow): IptvSource {
  const rows = db
    .select({ missing: channels.iptvMissing, epgMatch: channels.epgMatch })
    .from(channels)
    .where(eq(channels.iptvSourceId, row.id))
    .all()
    .filter((channel) => !channel.missing);
  const guideChannelCount = db.select({ id: iptvEpgChannels.epgId }).from(iptvEpgChannels).where(eq(iptvEpgChannels.sourceId, row.id)).all().length;
  return {
    id: row.id,
    name: row.name,
    m3uUrl: row.m3uUrl,
    xmltvUrl: row.xmltvUrl,
    playlistEpgUrl: row.playlistEpgUrl,
    refreshedAt: row.refreshedAt,
    status: (["pending", "refreshing", "ok", "error"].includes(row.status) ? row.status : "pending") as IptvSourceStatus,
    error: row.error,
    epgError: row.epgError,
    channelCount: rows.length,
    matchedCount: rows.filter((channel) => channel.epgMatch).length,
    guideChannelCount,
  };
}

export function listSources() {
  return db.select().from(iptvSources).orderBy(asc(iptvSources.createdAt)).all().map(sourceDto);
}

export function getSource(id: string) {
  const row = db.select().from(iptvSources).where(eq(iptvSources.id, id)).get();
  return row ? sourceDto(row) : null;
}

export function sourceNames() {
  return new Map(db.select({ id: iptvSources.id, name: iptvSources.name }).from(iptvSources).all().map((row) => [row.id, row.name]));
}

/** An http(s) address or an absolute path to a file on this machine. */
function isLocation(value: string) {
  if (/^https?:\/\/[^\s]+$/i.test(value)) {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }
  return path.isAbsolute(value) && !/^\\\\\?\\/.test(value);
}

export function validateSourceInput(body: Record<string, unknown>): IptvSourceInput {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60) throw new IptvError("bad_name");
  const m3uUrl = typeof body.m3uUrl === "string" ? body.m3uUrl.trim() : "";
  if (!m3uUrl || m3uUrl.length > 2000 || !isLocation(m3uUrl)) throw new IptvError("bad_m3u_url");
  const rawGuide = body.xmltvUrl;
  if (rawGuide != null && typeof rawGuide !== "string") throw new IptvError("bad_xmltv_url");
  const xmltvUrl = typeof rawGuide === "string" && rawGuide.trim() ? rawGuide.trim() : null;
  if (xmltvUrl && (xmltvUrl.length > 2000 || !isLocation(xmltvUrl))) throw new IptvError("bad_xmltv_url");
  return { name, m3uUrl, xmltvUrl };
}

export function createSource(input: IptvSourceInput) {
  const id = randomUUID();
  const now = Date.now();
  db.insert(iptvSources).values({ id, name: input.name, m3uUrl: input.m3uUrl, xmltvUrl: input.xmltvUrl, status: "pending", createdAt: now, updatedAt: now }).run();
  void refreshSource(id).catch(() => undefined);
  return getSource(id)!;
}

/** Adds one of the public playlists; each can be added once. `name` comes in the viewer's language. */
export function createPresetSource(presetId: unknown, name: unknown) {
  const preset = IPTV_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) throw new IptvError("bad_preset");
  const label = typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : `IPTV ${preset.country}`;
  if (db.select({ id: iptvSources.id }).from(iptvSources).where(eq(iptvSources.m3uUrl, preset.m3uUrl)).get()) throw new IptvError("preset_exists");
  return createSource({ name: label, m3uUrl: preset.m3uUrl, xmltvUrl: preset.xmltvUrl });
}

export function updateSource(id: string, input: IptvSourceInput) {
  const row = db.select().from(iptvSources).where(eq(iptvSources.id, id)).get();
  if (!row) return null;
  db.update(iptvSources).set({ name: input.name, m3uUrl: input.m3uUrl, xmltvUrl: input.xmltvUrl, updatedAt: Date.now() }).where(eq(iptvSources.id, id)).run();
  // A new address is read right away; a renamed source needs nothing more.
  if (row.m3uUrl !== input.m3uUrl || row.xmltvUrl !== input.xmltvUrl) void refreshSource(id).catch(() => undefined);
  return getSource(id);
}

export function deleteSource(id: string, removeLogo: (name: string | null) => void) {
  const row = db.select().from(iptvSources).where(eq(iptvSources.id, id)).get();
  if (!row) return false;
  const owned = db.select({ id: channels.id, logoPath: channels.logoPath }).from(channels).where(eq(channels.iptvSourceId, id)).all();
  for (const channel of owned) {
    stopRelay(channel.id);
    removeLogo(channel.logoPath);
  }
  db.transaction((tx) => {
    tx.delete(channels).where(eq(channels.iptvSourceId, id)).run();
    tx.delete(iptvSources).where(eq(iptvSources.id, id)).run();
  });
  fs.rmSync(guideFile(id), { force: true });
  return true;
}

/* Loading --------------------------------------------------------------------- */

async function* bodyChunks(location: string, timeoutMs: number): AsyncGenerator<Buffer> {
  if (/^https?:\/\//i.test(location)) {
    const response = await fetch(location, { headers: { "User-Agent": USER_AGENT, accept: "*/*" }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    if (!response.ok || !response.body) throw new IptvError(`http_${response.status}`);
    for await (const chunk of Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>)) yield chunk as Buffer;
    return;
  }
  if (!fs.existsSync(location) || !fs.statSync(location).isFile()) throw new IptvError("file_not_found");
  for await (const chunk of fs.createReadStream(location)) yield chunk as Buffer;
}

function isGzip(bytes: Buffer) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function loadPlaylist(location: string) {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of bodyChunks(location, PLAYLIST_TIMEOUT_MS)) {
    size += chunk.length;
    if (size > MAX_PLAYLIST_BYTES) throw new IptvError("playlist_too_large");
    parts.push(chunk);
  }
  let bytes = Buffer.concat(parts);
  if (isGzip(bytes)) bytes = zlib.gunzipSync(bytes, { maxOutputLength: MAX_PLAYLIST_BYTES * 4 });
  return bytes.toString("utf8");
}

/** Downloads the guide next to the other caches, so a manual match can be applied without fetching it again. */
async function downloadGuide(location: string, file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.part`;
  const out = fs.createWriteStream(partial);
  let size = 0;
  try {
    for await (const chunk of bodyChunks(location, GUIDE_TIMEOUT_MS)) {
      size += chunk.length;
      if (size > MAX_GUIDE_BYTES) throw new IptvError("guide_too_large");
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    fs.renameSync(partial, file);
  } catch (error) {
    out.destroy();
    fs.rmSync(partial, { force: true });
    throw error;
  }
}

async function readGuide(file: string, reader: XmltvReader) {
  const head = Buffer.alloc(2);
  const handle = fs.openSync(file, "r");
  try {
    fs.readSync(handle, head, 0, 2, 0);
  } finally {
    fs.closeSync(handle);
  }
  const raw = fs.createReadStream(file);
  let stream: Readable = raw;
  if (isGzip(head)) {
    const gunzip = zlib.createGunzip();
    raw.on("error", (error) => gunzip.destroy(error));
    stream = raw.pipe(gunzip);
  }
  let decoder: { write(bytes: Buffer): string; end(): string | undefined } | null = null;
  let size = 0;
  for await (const chunk of stream) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > MAX_GUIDE_TEXT_BYTES) {
      stream.destroy();
      throw new IptvError("guide_too_large");
    }
    if (!decoder) {
      const encoding = declaredEncoding(bytes.subarray(0, 300).toString("latin1"));
      decoder = iconv.getDecoder(encoding && iconv.encodingExists(encoding) ? encoding : "utf8");
    }
    reader.push(decoder.write(bytes));
  }
  reader.push(decoder?.end() ?? "");
  reader.end();
}

/* Refresh ---------------------------------------------------------------------- */

const running = new Map<string, Promise<void>>();

function setStatus(id: string, change: Partial<typeof iptvSources.$inferInsert>) {
  db.update(iptvSources).set(change).where(eq(iptvSources.id, id)).run();
}

function errorCode(error: unknown) {
  if (error instanceof IptvError) return error.message;
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    return (cause?.code ?? error.message).slice(0, 200);
  }
  return "failed";
}

/** Adds new playlist entries as channels, updates the known ones, marks the ones that went away. */
function importEntries(sourceId: string, entries: M3uEntry[]) {
  const now = Date.now();
  const keys = entryKeys(entries);
  const existing = new Map(
    db
      .select()
      .from(channels)
      .where(eq(channels.iptvSourceId, sourceId))
      .all()
      .map((row) => [row.iptvKey ?? "", row]),
  );
  const fresh = entries.map((entry, index) => ({ entry, key: keys[index]! })).filter((item) => !existing.has(item.key));
  const taken = new Set(db.select({ number: channels.number }).from(channels).all().map((row) => row.number));
  const numbers = assignNumbers(fresh.map((item) => item.entry), taken);
  const seen = new Set(keys);
  db.transaction((tx) => {
    entries.forEach((entry, index) => {
      const row = existing.get(keys[index]!);
      if (!row) return;
      tx.update(channels)
        .set({
          streamUrl: entry.url,
          tvgId: entry.tvgId,
          m3uName: entry.name,
          // A channel renamed by hand keeps its name.
          name: row.name === row.m3uName ? entry.name : row.name,
          remoteLogo: entry.tvgLogo,
          groupTitle: entry.group,
          iptvMissing: false,
          ...(row.remoteLogo !== entry.tvgLogo ? { updatedAt: now } : {}),
        })
        .where(eq(channels.id, row.id))
        .run();
    });
    const rows = fresh.flatMap((item, index) => {
      const number = numbers[index];
      if (number == null) return [];
      return [
        {
          id: randomUUID(),
          kind: "iptv",
          number,
          name: item.entry.name,
          logoPath: null,
          orderMode: "sequential",
          seed: 0,
          enabled: true,
          categoryOverride: null,
          autoKey: null,
          iptvSourceId: sourceId,
          iptvKey: item.key,
          streamUrl: item.entry.url,
          tvgId: item.entry.tvgId,
          m3uName: item.entry.name,
          remoteLogo: item.entry.tvgLogo,
          groupTitle: item.entry.group,
          epgChannel: null,
          epgMatch: null,
          iptvMissing: false,
          createdAt: now,
          updatedAt: now,
        },
      ];
    });
    for (const part of chunks(rows, 200)) tx.insert(channels).values(part).run();
    for (const [key, row] of existing) {
      if (!seen.has(key) && !row.iptvMissing) tx.update(channels).set({ iptvMissing: true }).where(eq(channels.id, row.id)).run();
    }
  });
  for (const [key, row] of existing) if (!seen.has(key)) stopRelay(row.id);
}

/**
 * Reads the source's cached guide and replaces the programs of its channels. Channels come before
 * programmes in XMLTV, so matching happens once, at the first programme.
 */
export async function applyGuide(sourceId: string, now = Date.now()) {
  const rows = db
    .select({ id: channels.id, name: channels.name, tvgId: channels.tvgId, m3uName: channels.m3uName, epgChannel: channels.epgChannel })
    .from(channels)
    .where(and(eq(channels.iptvSourceId, sourceId), eq(channels.iptvMissing, false)))
    .all();
  const file = guideFile(sourceId);
  const guide: XmltvChannel[] = [];
  const programmes = new Map<string, XmltvProgramme[]>();
  const how = new Map<string, EpgMatch>();
  let byEpg: Map<string, string[]> | null = null;
  const from = now - KEEP_PAST_MS;
  const to = now + HORIZON_MS;

  const buildLookup = () => {
    const matches = matchGuideChannels(
      rows.map((row) => ({ id: row.id, name: row.name, tvgId: row.tvgId, tvgName: row.m3uName, epgChannel: row.epgChannel })),
      guide,
    );
    const lookup = new Map<string, string[]>();
    const add = (epgId: string, channelId: string) => {
      const key = epgId.toLowerCase();
      lookup.set(key, [...(lookup.get(key) ?? []), channelId]);
    };
    for (const [channelId, match] of matches) {
      add(match.epgId, channelId);
      how.set(channelId, match.how);
    }
    // A guide without <channel> entries can still be matched by tvg-id.
    for (const row of rows) {
      if (!matches.has(row.id) && row.tvgId) {
        for (const key of tvgIdKeys(row.tvgId)) add(key, row.id);
      }
    }
    return lookup;
  };

  if (fs.existsSync(file)) {
    const reader = new XmltvReader({
      channel: (channel) => {
        if (guide.length < MAX_GUIDE_CHANNELS) guide.push(channel);
      },
      programme: (programme) => {
        byEpg ??= buildLookup();
        const ids = byEpg.get(programme.channel.toLowerCase());
        if (!ids) return;
        if (Number.isFinite(programme.end) ? programme.end <= from : programme.start < from - 6 * 60 * 60 * 1000) return;
        if (programme.start >= to) return;
        for (const id of ids) {
          const list = programmes.get(id);
          if (list) list.push(programme);
          else programmes.set(id, [programme]);
          if (!how.has(id)) how.set(id, "tvg-id");
        }
      },
    });
    await readGuide(file, reader);
  }
  byEpg ??= buildLookup();

  const ids = rows.map((row) => row.id);
  db.transaction((tx) => {
    tx.delete(iptvEpgChannels).where(eq(iptvEpgChannels.sourceId, sourceId)).run();
    const seen = new Set<string>();
    const options = guide.flatMap((channel) => {
      if (seen.has(channel.id)) return [];
      seen.add(channel.id);
      return [{ sourceId, epgId: channel.id.slice(0, 200), name: (channel.names[0] ?? channel.id).slice(0, 200) }];
    });
    for (const part of chunks(options, 300)) tx.insert(iptvEpgChannels).values(part).onConflictDoNothing().run();
    for (const part of chunks(ids, 500)) tx.delete(channelPrograms).where(inArray(channelPrograms.channelId, part)).run();
    for (const row of rows) {
      const list = tidyProgrammes(programmes.get(row.id) ?? []).filter((programme) => programme.end > from && programme.start < to);
      const values = list.map((programme, seq) => ({
        channelId: row.id,
        start: programme.start,
        end: programme.end,
        seq,
        itemType: "external",
        itemId: null,
        fileId: null,
        title: programme.title,
        subtitle: programme.subtitle,
        description: programme.description,
        image: null,
      }));
      for (const part of chunks(values, 300)) tx.insert(channelPrograms).values(part).run();
      tx.update(channels).set({ epgMatch: how.get(row.id) ?? null }).where(eq(channels.id, row.id)).run();
    }
  });
}

/** Reloads the playlist, then the guide. Overlapping calls for one source share the run. */
export function refreshSource(id: string): Promise<void> {
  const pending = running.get(id);
  if (pending) return pending;
  const job = (async () => {
    const row = db.select().from(iptvSources).where(eq(iptvSources.id, id)).get();
    if (!row) return;
    setStatus(id, { status: "refreshing", error: null });
    try {
      const playlist = parseM3u(await loadPlaylist(row.m3uUrl));
      if (playlist.entries.length === 0) throw new IptvError("empty_playlist");
      importEntries(id, playlist.entries.slice(0, MAX_CHANNELS_PER_SOURCE));
      setStatus(id, { playlistEpgUrl: playlist.epgUrl });
      const guideUrl = row.xmltvUrl ?? playlist.epgUrl;
      let epgError: string | null = null;
      if (guideUrl) {
        try {
          await downloadGuide(guideUrl, guideFile(id));
        } catch (error) {
          // An older copy of the guide still fills the next hours.
          epgError = errorCode(error);
        }
      } else fs.rmSync(guideFile(id), { force: true });
      try {
        await applyGuide(id);
      } catch (error) {
        epgError ??= errorCode(error);
      }
      setStatus(id, { status: "ok", error: null, epgError, refreshedAt: Date.now() });
    } catch (error) {
      setStatus(id, { status: "error", error: errorCode(error), refreshedAt: Date.now() });
    }
  })().finally(() => running.delete(id));
  running.set(id, job);
  return job;
}

export function isRefreshing(id: string) {
  return running.has(id);
}

/** The 12-hour job; also picks up sources a stopped server left half refreshed. */
export async function refreshDueSources(now = Date.now()) {
  for (const row of db.select().from(iptvSources).all()) {
    const due = row.refreshedAt == null || now - row.refreshedAt >= REFRESH_EVERY_MS || (row.status === "refreshing" && !running.has(row.id));
    if (due) await refreshSource(row.id).catch(() => undefined);
  }
}

/* Manual guide matching ---------------------------------------------------------- */

export function guideChannels(sourceId: string): GuideChannelOption[] | null {
  if (!db.select({ id: iptvSources.id }).from(iptvSources).where(eq(iptvSources.id, sourceId)).get()) return null;
  return db
    .select({ id: iptvEpgChannels.epgId, name: iptvEpgChannels.name })
    .from(iptvEpgChannels)
    .where(eq(iptvEpgChannels.sourceId, sourceId))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Chooses a guide channel by hand (null goes back to automatic matching) and applies the cached guide. */
export async function setEpgChannel(channelId: string, epgChannel: unknown) {
  if (epgChannel !== null && (typeof epgChannel !== "string" || !epgChannel.trim() || epgChannel.length > 200)) throw new IptvError("bad_epg_channel");
  const row = db.select().from(channels).where(eq(channels.id, channelId)).get();
  if (!row || row.kind !== "iptv" || !row.iptvSourceId) return false;
  db.update(channels).set({ epgChannel: epgChannel === null ? null : epgChannel.trim() }).where(eq(channels.id, channelId)).run();
  await applyGuide(row.iptvSourceId);
  return true;
}

/* Remote logos -------------------------------------------------------------------- */

const MAX_REMOTE_LOGO_BYTES = 1024 * 1024;
const LOGO_RETRY_MS = 60 * 60 * 1000;
const logoFailures = new Map<string, number>();
const logoInflight = new Map<string, Promise<string | null>>();

/** PNG, JPEG, GIF or WebP by their first bytes; anything else (SVG, HTML) is refused. */
export function sniffImage(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("latin1"))) return "gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

export const LOGO_CONTENT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** The tvg-logo image, fetched once and kept on disk; null while it cannot be had. */
export function remoteLogoFile(url: string): Promise<string | null> {
  const hash = createHash("sha1").update(url).digest("hex");
  for (const extension of Object.keys(LOGO_CONTENT_TYPES)) {
    const file = path.join(remoteLogoDir, `${hash}.${extension}`);
    if (fs.existsSync(file)) return Promise.resolve(file);
  }
  if (Date.now() - (logoFailures.get(hash) ?? 0) < LOGO_RETRY_MS) return Promise.resolve(null);
  const pending = logoInflight.get(hash);
  if (pending) return pending;
  const job = (async () => {
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, accept: "image/*" }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("http");
      const declared = Number(response.headers.get("content-length"));
      if (declared > MAX_REMOTE_LOGO_BYTES) throw new Error("large");
      const bytes = Buffer.from(await response.arrayBuffer());
      const extension = bytes.length <= MAX_REMOTE_LOGO_BYTES ? sniffImage(bytes) : null;
      if (!extension) throw new Error("type");
      fs.mkdirSync(remoteLogoDir, { recursive: true });
      const file = path.join(remoteLogoDir, `${hash}.${extension}`);
      fs.writeFileSync(file, bytes);
      return file;
    } catch {
      logoFailures.set(hash, Date.now());
      return null;
    }
  })().finally(() => logoInflight.delete(hash));
  logoInflight.set(hash, job);
  return job;
}
