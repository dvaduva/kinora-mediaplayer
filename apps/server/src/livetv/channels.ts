import fs from "node:fs";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import type { ChannelAlign, ChannelFiller, ChannelInput, ChannelNow, ChannelOrder, ChannelProgram, ChannelSource, EpgMatchKind, LibraryType, LiveChannel, LivePlayback, LiveTvSettings, ProgramItemType } from "@kinora/shared";
import { BROWSER_PROFILE, isChannelAlign, isChannelSourceType, type CapabilityProfile, type EffectiveProfile } from "@kinora/shared";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, lte, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { channelPrograms, channels, channelSources, episodes, mediaFiles, movies, profileChannels, tracks } from "../db/schema.js";
import { dataDir } from "../paths.js";
import { beginTranscode, describePlayback, wholeTranscodeReach } from "../playback/session.js";
import { backgroundTranscodes, hasForegroundTranscode, sessionStarts, stopBackgroundTranscode } from "../playback/transcode.js";
import { getSetting, PROFILE_ID, setSetting } from "../settings.js";
import { DEFAULT_SERIES_MIN_EPISODES, newAutoChannels, planAutoChannels } from "./auto.js";
import { deriveCategory, isMusicChannel } from "./categories.js";
import { fillerFor } from "./filler.js";
import { decidePrepare, markWatching, watchedChannels, type UpcomingProgram } from "./prepare.js";
import { remoteLogoFile, sourceNames } from "./iptv.js";
import { startRelay, stopRelay } from "./relay.js";
import { libraryInventory, libraryTypes, resolveSources } from "./sources.js";
import { continueSchedule, HORIZON_MS, KEEP_PAST_MS } from "./schedule.js";

type ChannelRow = typeof channels.$inferSelect;
type ProgramRow = typeof channelPrograms.$inferSelect;

export const logoDir = path.join(dataDir, "channel-logos");
/** Live sessions start on a segment boundary, so viewers joining the same program share the conversion. */
const LIVE_SEGMENT = 4;
/** Joining this early in a program uses the whole-file conversion, which can be kept for later viewing. */
const WHOLE_FILE_BEFORE = 30;
/** A program is topped up when less than this is scheduled ahead. */
const TOP_UP_MARGIN_MS = 2 * 60 * 60 * 1000;

export class ChannelError extends Error {}

function chunks<T>(list: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

function sourcesOf(channelId: string): ChannelSource[] {
  return db
    .select()
    .from(channelSources)
    .where(eq(channelSources.channelId, channelId))
    .orderBy(asc(channelSources.id))
    .all()
    .flatMap((row) => (isChannelSourceType(row.type) ? [{ type: row.type, value: row.value }] : []));
}

/** Latest scheduled end per channel, to tell which channels have nothing left to air. */
function scheduledUntil() {
  const until = new Map<string, number>();
  for (const row of db.select({ channelId: channelPrograms.channelId, end: channelPrograms.end }).from(channelPrograms).where(gt(channelPrograms.end, Date.now())).all()) {
    until.set(row.channelId, Math.max(until.get(row.channelId) ?? 0, row.end));
  }
  return until;
}

/** Lookups shared by every channel of one listing. */
interface DtoContext {
  until: Map<string, number>;
  libraryType: (id: string) => LibraryType | undefined;
  profile: Map<string, { favorite: boolean; position: number | null }>;
  sources: Map<string, string>;
}

function dtoContext(): DtoContext {
  const types = libraryTypes();
  const profile = new Map(
    db
      .select()
      .from(profileChannels)
      .where(eq(profileChannels.profileId, PROFILE_ID))
      .all()
      .map((row) => [row.channelId, { favorite: row.favorite, position: row.position }]),
  );
  return { until: scheduledUntil(), libraryType: (id) => types.get(id), profile, sources: sourceNames() };
}

function isIptv(row: Pick<ChannelRow, "kind">) {
  return row.kind === "iptv";
}

function iptvDto(row: ChannelRow, context: DtoContext): LiveChannel {
  return {
    id: row.id,
    kind: "iptv",
    number: row.number,
    name: row.name,
    logoUrl: row.logoPath || row.remoteLogo ? `/api/livetv/channels/${row.id}/logo?v=${row.updatedAt}` : null,
    orderMode: "sequential",
    enabled: row.enabled,
    sources: [],
    // A live stream always has something on; only a channel the playlist dropped has nothing to air.
    empty: row.iptvMissing || !row.streamUrl,
    category: row.categoryOverride || row.groupTitle,
    categoryOverride: row.categoryOverride,
    auto: false,
    music: false,
    favorite: context.profile.get(row.id)?.favorite ?? false,
    iptv: {
      sourceId: row.iptvSourceId ?? "",
      sourceName: context.sources.get(row.iptvSourceId ?? "") ?? "",
      group: row.groupTitle,
      tvgId: row.tvgId,
      epgChannel: row.epgChannel,
      epgMatch: (["manual", "tvg-id", "name"].includes(row.epgMatch ?? "") ? row.epgMatch : null) as EpgMatchKind | null,
      missing: row.iptvMissing,
    },
    alignMinutes: 0,
    filler: "upnext",
  };
}

function alignOf(row: Pick<ChannelRow, "alignMinutes">): ChannelAlign {
  return isChannelAlign(row.alignMinutes) ? row.alignMinutes : 0;
}

function fillerOf(row: Pick<ChannelRow, "filler">): ChannelFiller {
  return row.filler === "upnext" ? "upnext" : "media";
}

function channelDto(row: ChannelRow, context: DtoContext): LiveChannel {
  if (isIptv(row)) return iptvDto(row, context);
  const sources = sourcesOf(row.id);
  return {
    id: row.id,
    kind: row.kind === "iptv" ? "iptv" : "virtual",
    number: row.number,
    name: row.name,
    logoUrl: row.logoPath ? `/api/livetv/channels/${row.id}/logo?v=${row.updatedAt}` : null,
    orderMode: row.orderMode === "sequential" ? "sequential" : "shuffle",
    enabled: row.enabled,
    sources,
    empty: !context.until.has(row.id),
    category: row.categoryOverride || deriveCategory(sources, context.libraryType),
    categoryOverride: row.categoryOverride,
    auto: row.autoKey != null,
    music: isMusicChannel(sources, context.libraryType),
    favorite: context.profile.get(row.id)?.favorite ?? false,
    iptv: null,
    alignMinutes: alignOf(row),
    filler: fillerOf(row),
  };
}

/** All channels in the profile's order: the ones it placed first, then the rest by number. */
export function listChannels(): LiveChannel[] {
  const context = dtoContext();
  const position = (id: string) => context.profile.get(id)?.position ?? null;
  return db
    .select()
    .from(channels)
    .orderBy(asc(channels.number), asc(channels.name))
    .all()
    .sort((a, b) => {
      const pa = position(a.id);
      const pb = position(b.id);
      if (pa != null && pb != null) return pa - pb;
      if (pa != null) return -1;
      if (pb != null) return 1;
      return 0;
    })
    .map((row) => channelDto(row, context));
}

/** Channels the guide and the player show: enabled and with something to air. */
export function visibleChannels() {
  return listChannels().filter((channel) => channel.enabled && !channel.empty);
}

export function getChannel(id: string): LiveChannel | null {
  const row = db.select().from(channels).where(eq(channels.id, id)).get();
  return row ? channelDto(row, dtoContext()) : null;
}

function programDtos(rows: ProgramRow[]): ChannelProgram[] {
  const episodeIds = [...new Set(rows.filter((row) => row.itemType === "episode" && row.itemId).map((row) => row.itemId!))];
  const movieIds = [...new Set(rows.filter((row) => row.itemType === "movie" && row.itemId).map((row) => row.itemId!))];
  const trackIds = [...new Set(rows.filter((row) => row.itemType === "track" && row.itemId).map((row) => row.itemId!))];
  const albumOf = new Map<string, string>();
  for (const part of chunks(trackIds, 500)) {
    for (const row of db.select({ id: tracks.id, albumId: tracks.albumId }).from(tracks).where(inArray(tracks.id, part)).all()) albumOf.set(row.id, row.albumId);
  }
  const seriesOf = new Map<string, string>();
  for (const part of chunks(episodeIds, 500)) {
    for (const row of db.select({ id: episodes.id, seriesId: episodes.seriesId }).from(episodes).where(inArray(episodes.id, part)).all()) seriesOf.set(row.id, row.seriesId);
  }
  const movieSet = new Set<string>();
  for (const part of chunks(movieIds, 500)) {
    for (const row of db.select({ id: movies.id }).from(movies).where(inArray(movies.id, part)).all()) movieSet.add(row.id);
  }
  return rows.map((row) => {
    const libraryPath =
      row.itemType === "movie" && row.itemId && movieSet.has(row.itemId)
        ? `/movies/${row.itemId}`
        : row.itemType === "episode" && row.itemId && seriesOf.has(row.itemId)
          ? `/series/${seriesOf.get(row.itemId)}`
          : row.itemType === "track" && row.itemId && albumOf.has(row.itemId)
            ? `/music/albums/${albumOf.get(row.itemId)}`
            : null;
    return {
      id: row.id,
      channelId: row.channelId,
      start: row.start,
      end: row.end,
      itemType: row.itemType as ProgramItemType,
      itemId: row.itemId,
      fileId: row.fileId,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      image: row.image,
      libraryPath,
    };
  });
}

/**
 * Brings a channel's stored program up to now + 72h. `cutAt` rebuilds from that time: now after an
 * edit (the program on air stays), or the start of a program whose file went missing.
 */
export function scheduleChannel(channelId: string, options: { cutAt?: number | null; now?: number } = {}) {
  const channel = db.select().from(channels).where(eq(channels.id, channelId)).get();
  // IPTV programs come from the guide, not from rules.
  if (!channel || isIptv(channel)) return;
  const now = options.now ?? Date.now();
  const items = channel.enabled ? resolveSources(sourcesOf(channelId)) : [];
  let existing = db
    .select({ start: channelPrograms.start, end: channelPrograms.end, seq: channelPrograms.seq })
    .from(channelPrograms)
    .where(and(eq(channelPrograms.channelId, channelId), gt(channelPrograms.end, now - KEEP_PAST_MS)))
    .orderBy(asc(channelPrograms.start))
    .all();
  if (existing.length === 0) {
    // After a long stop, keep counting from the last program aired so the order carries on.
    const last = db
      .select({ start: channelPrograms.start, end: channelPrograms.end, seq: channelPrograms.seq })
      .from(channelPrograms)
      .where(eq(channelPrograms.channelId, channelId))
      .orderBy(desc(channelPrograms.start))
      .get();
    existing = last ? [last] : [];
  }
  const plan = continueSchedule({
    existing,
    items,
    mode: channel.orderMode as ChannelOrder,
    seed: channel.seed,
    now,
    cutAt: options.cutAt ?? null,
    alignMinutes: alignOf(channel),
  });
  db.transaction((tx) => {
    if (plan.removeFrom != null) {
      tx.delete(channelPrograms).where(and(eq(channelPrograms.channelId, channelId), gte(channelPrograms.start, plan.removeFrom))).run();
    }
    for (const part of chunks(plan.add, 400)) {
      tx.insert(channelPrograms).values(part.map((program) => ({ ...program, channelId }))).run();
    }
    // Old programs go, except the newest one, which carries the play order forward.
    const newest = tx.select({ id: channelPrograms.id }).from(channelPrograms).where(eq(channelPrograms.channelId, channelId)).orderBy(desc(channelPrograms.start)).get();
    tx.delete(channelPrograms)
      .where(and(eq(channelPrograms.channelId, channelId), lt(channelPrograms.end, now - KEEP_PAST_MS), newest ? ne(channelPrograms.id, newest.id) : undefined))
      .run();
  });
}

/** Rebuilds channels whose upcoming programs point at files that are gone or marked missing. */
export function repairMissing(now = Date.now()) {
  const upcoming = db
    .select({ channelId: channelPrograms.channelId, start: channelPrograms.start, fileId: channelPrograms.fileId })
    .from(channelPrograms)
    .where(gt(channelPrograms.end, now))
    .orderBy(asc(channelPrograms.start))
    .all();
  const fileIds = [...new Set(upcoming.flatMap((row) => (row.fileId ? [row.fileId] : [])))];
  const present = new Set<string>();
  for (const part of chunks(fileIds, 500)) {
    for (const row of db.select({ id: mediaFiles.id }).from(mediaFiles).where(and(inArray(mediaFiles.id, part), eq(mediaFiles.missing, false))).all()) present.add(row.id);
  }
  const cuts = new Map<string, number>();
  for (const row of upcoming) {
    if (row.fileId && !present.has(row.fileId) && !cuts.has(row.channelId)) cuts.set(row.channelId, row.start);
  }
  for (const [channelId, cutAt] of cuts) scheduleChannel(channelId, { cutAt, now });
  return cuts.size;
}

/** The hourly job: keeps every enabled channel 72h ahead and replaces programs whose files went away. */
export function topUpChannels(now = Date.now()) {
  repairMissing(now);
  const until = scheduledUntil();
  for (const channel of db.select().from(channels).where(and(eq(channels.enabled, true), eq(channels.kind, "virtual"))).all()) {
    if ((until.get(channel.id) ?? 0) < now + HORIZON_MS - TOP_UP_MARGIN_MS) scheduleChannel(channel.id, { now });
  }
}

export function validateChannelInput(body: Record<string, unknown>): ChannelInput {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60) throw new ChannelError("bad_name");
  const number = body.number;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > 9999) throw new ChannelError("bad_number");
  const orderMode = body.orderMode;
  if (orderMode !== "sequential" && orderMode !== "shuffle") throw new ChannelError("bad_order");
  const enabled = body.enabled === undefined ? true : body.enabled;
  if (typeof enabled !== "boolean") throw new ChannelError("bad_enabled");
  if (!Array.isArray(body.sources) || body.sources.length > 100) throw new ChannelError("bad_sources");
  const sources: ChannelSource[] = [];
  const seen = new Set<string>();
  for (const raw of body.sources as unknown[]) {
    const entry = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const value = typeof entry.value === "string" ? entry.value.trim() : "";
    if (!isChannelSourceType(entry.type) || !value || value.length > 200) throw new ChannelError("bad_sources");
    if (entry.type === "decade" && !/^\d{3}0$/.test(value)) throw new ChannelError("bad_sources");
    const id = `${entry.type}\u0000${value.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    sources.push({ type: entry.type, value });
  }
  const rawCategory = body.categoryOverride;
  if (rawCategory != null && typeof rawCategory !== "string") throw new ChannelError("bad_category");
  const categoryOverride = typeof rawCategory === "string" && rawCategory.trim() ? rawCategory.trim() : null;
  if (categoryOverride && (categoryOverride.length > 40 || categoryOverride.startsWith("@"))) throw new ChannelError("bad_category");
  const alignMinutes = body.alignMinutes === undefined ? 0 : body.alignMinutes;
  if (!isChannelAlign(alignMinutes)) throw new ChannelError("bad_align");
  const filler = body.filler === undefined ? "media" : body.filler;
  if (filler !== "media" && filler !== "upnext") throw new ChannelError("bad_filler");
  return { name, number, orderMode, enabled, sources, categoryOverride, alignMinutes, filler };
}

function writeSources(channelId: string, sources: ChannelSource[]) {
  db.delete(channelSources).where(eq(channelSources.channelId, channelId)).run();
  if (sources.length > 0) db.insert(channelSources).values(sources.map((source) => ({ channelId, type: source.type, value: source.value }))).run();
}

function assertNumberFree(number: number, exceptId: string | null) {
  const taken = db
    .select({ id: channels.id })
    .from(channels)
    .where(exceptId ? and(eq(channels.number, number), ne(channels.id, exceptId)) : eq(channels.number, number))
    .get();
  if (taken) throw new ChannelError("number_taken");
}

export function createChannel(input: ChannelInput, autoKey: string | null = null) {
  assertNumberFree(input.number, null);
  const id = randomUUID();
  const now = Date.now();
  db.insert(channels)
    .values({
      id,
      kind: "virtual",
      number: input.number,
      name: input.name,
      logoPath: null,
      orderMode: input.orderMode,
      seed: randomInt(0, 2 ** 31 - 1),
      enabled: input.enabled,
      categoryOverride: input.categoryOverride ?? null,
      alignMinutes: input.alignMinutes ?? 0,
      filler: input.filler ?? "media",
      autoKey,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  writeSources(id, input.sources);
  scheduleChannel(id, { cutAt: now, now });
  return getChannel(id)!;
}

export function updateChannel(id: string, input: ChannelInput) {
  const row = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!row) return null;
  assertNumberFree(input.number, id);
  const now = Date.now();
  if (isIptv(row)) {
    // Rules and order do not apply; the playlist keeps feeding the stream and the guide.
    db.update(channels)
      .set({ name: input.name, number: input.number, enabled: input.enabled, categoryOverride: input.categoryOverride ?? null, updatedAt: now })
      .where(eq(channels.id, id))
      .run();
    if (!input.enabled) stopRelay(id);
    return getChannel(id);
  }
  db.update(channels)
    .set({
      name: input.name,
      number: input.number,
      orderMode: input.orderMode,
      enabled: input.enabled,
      categoryOverride: input.categoryOverride ?? null,
      alignMinutes: input.alignMinutes ?? 0,
      filler: input.filler ?? "media",
      updatedAt: now,
    })
    .where(eq(channels.id, id))
    .run();
  writeSources(id, input.sources);
  // The program on air keeps running; everything after it follows the new rules.
  scheduleChannel(id, { cutAt: now, now });
  return getChannel(id);
}

export function regenerateChannel(id: string) {
  const row = db.select({ id: channels.id, kind: channels.kind }).from(channels).where(eq(channels.id, id)).get();
  if (!row) return null;
  if (isIptv(row)) return getChannel(id);
  const now = Date.now();
  scheduleChannel(id, { cutAt: now, now });
  return getChannel(id);
}

export function removeLogoFile(name: string | null) {
  if (!name) return;
  try {
    fs.rmSync(path.join(logoDir, path.basename(name)), { force: true });
  } catch {
    // A leftover logo file does no harm.
  }
}

export function deleteChannel(id: string) {
  const row = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!row) return false;
  // The next refresh would bring it back; IPTV channels are turned off instead, or go with their source.
  if (isIptv(row)) throw new ChannelError("iptv_channel");
  db.delete(channels).where(eq(channels.id, id)).run();
  removeLogoFile(row.logoPath);
  // A deleted automatic channel is not generated again.
  if (row.autoKey) setSetting("liveAutoDismissed", JSON.stringify([...new Set([...dismissedAutoKeys(), row.autoKey])]));
  return true;
}

/* Favorites and order (per profile) ----------------------------------------- */

export function setFavorite(id: string, favorite: boolean) {
  if (!db.select({ id: channels.id }).from(channels).where(eq(channels.id, id)).get()) return null;
  db.insert(profileChannels)
    .values({ profileId: PROFILE_ID, channelId: id, favorite, position: null })
    .onConflictDoUpdate({ target: [profileChannels.profileId, profileChannels.channelId], set: { favorite } })
    .run();
  return getChannel(id);
}

/** Puts the listed channels first, in that order; `[]` goes back to ordering by number. */
export function setChannelOrder(ids: unknown) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || ids.length > 10_000) throw new ChannelError("bad_order");
  const known = new Set(db.select({ id: channels.id }).from(channels).all().map((row) => row.id));
  const order = [...new Set(ids as string[])].filter((id) => known.has(id));
  db.transaction((tx) => {
    tx.update(profileChannels).set({ position: null }).where(eq(profileChannels.profileId, PROFILE_ID)).run();
    order.forEach((channelId, position) => {
      tx.insert(profileChannels)
        .values({ profileId: PROFILE_ID, channelId, favorite: false, position })
        .onConflictDoUpdate({ target: [profileChannels.profileId, profileChannels.channelId], set: { position } })
        .run();
    });
  });
  return listChannels();
}

/* Automatic channels --------------------------------------------------------- */

function dismissedAutoKeys(): string[] {
  try {
    const parsed: unknown = JSON.parse(getSetting("liveAutoDismissed") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

export function liveTvSettings(): LiveTvSettings {
  const min = Number(getSetting("liveAutoSeriesMinEpisodes"));
  return {
    autoChannels: getSetting("liveAutoChannels") === "1",
    autoSeriesMinEpisodes: Number.isInteger(min) && min > 0 ? min : DEFAULT_SERIES_MIN_EPISODES,
    prepareNext: getSetting("livePrepareNext") !== "0",
  };
}

export function saveLiveTvSettings(body: Record<string, unknown>): LiveTvSettings {
  const current = liveTvSettings();
  const autoChannels = body.autoChannels === undefined ? current.autoChannels : body.autoChannels;
  if (typeof autoChannels !== "boolean") throw new ChannelError("bad_settings");
  const min = body.autoSeriesMinEpisodes === undefined ? current.autoSeriesMinEpisodes : body.autoSeriesMinEpisodes;
  if (typeof min !== "number" || !Number.isInteger(min) || min < 1 || min > 10_000) throw new ChannelError("bad_settings");
  const prepareNext = body.prepareNext === undefined ? current.prepareNext : body.prepareNext;
  if (typeof prepareNext !== "boolean") throw new ChannelError("bad_settings");
  setSetting("liveAutoChannels", autoChannels ? "1" : null);
  setSetting("livePrepareNext", prepareNext ? null : "0");
  if (!prepareNext) for (const fileId of backgroundTranscodes()) stopBackgroundTranscode(fileId);
  setSetting("liveAutoSeriesMinEpisodes", String(min));
  return liveTvSettings();
}

/**
 * Creates the automatic channels the library calls for. Does nothing while automatic channels are
 * off; `force` runs it anyway (the "generate now" button), `restoreDismissed` brings deleted ones back.
 */
export function syncAutoChannels(options: { force?: boolean; restoreDismissed?: boolean } = {}) {
  const settings = liveTvSettings();
  if (!settings.autoChannels && !options.force) return { created: 0 };
  if (options.restoreDismissed) setSetting("liveAutoDismissed", null);
  const plans = planAutoChannels(libraryInventory(), settings.autoSeriesMinEpisodes);
  const rows = db.select({ number: channels.number, autoKey: channels.autoKey }).from(channels).all();
  const create = newAutoChannels(plans, new Set(rows.flatMap((row) => (row.autoKey ? [row.autoKey] : []))), new Set(dismissedAutoKeys()));
  let number = Math.max(0, ...rows.map((row) => row.number));
  let created = 0;
  for (const plan of create) {
    if (number >= 9999) break;
    number += 1;
    createChannel({ name: plan.name.slice(0, 60), number, orderMode: plan.orderMode, enabled: true, sources: plan.sources, categoryOverride: null }, plan.key);
    created += 1;
  }
  return { created };
}


const LOGO_TYPES: Record<string, string> = { png: "png", jpeg: "jpg", webp: "webp" };
const MAX_LOGO_BYTES = 1024 * 1024;

/** Stores an uploaded logo given as a data URL (PNG, JPEG or WebP, at most 1 MB). */
export function setChannelLogo(id: string, dataUrl: unknown) {
  const row = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!row) return null;
  const match = typeof dataUrl === "string" ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!match) throw new ChannelError("bad_logo");
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) throw new ChannelError("bad_logo");
  fs.mkdirSync(logoDir, { recursive: true });
  const now = Date.now();
  const name = `${id}-${now}.${LOGO_TYPES[match[1]!]}`;
  fs.writeFileSync(path.join(logoDir, name), bytes);
  db.update(channels).set({ logoPath: name, updatedAt: now }).where(eq(channels.id, id)).run();
  removeLogoFile(row.logoPath);
  return getChannel(id);
}

export function clearChannelLogo(id: string) {
  const row = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!row) return null;
  db.update(channels).set({ logoPath: null, updatedAt: Date.now() }).where(eq(channels.id, id)).run();
  removeLogoFile(row.logoPath);
  return getChannel(id);
}

/** The uploaded logo, or for IPTV channels the playlist's logo, fetched and kept by the server. */
export async function channelLogoFile(id: string) {
  const row = db.select({ logoPath: channels.logoPath, remoteLogo: channels.remoteLogo }).from(channels).where(eq(channels.id, id)).get();
  if (!row) return null;
  if (row.logoPath) {
    const file = path.join(logoDir, path.basename(row.logoPath));
    if (fs.existsSync(file)) return file;
  }
  return row.remoteLogo ? remoteLogoFile(row.remoteLogo) : null;
}

export function guide(from: number, to: number) {
  const shown = visibleChannels();
  const ids = shown.map((channel) => channel.id);
  const rows = ids.length
    ? db
        .select()
        .from(channelPrograms)
        .where(and(inArray(channelPrograms.channelId, ids), lt(channelPrograms.start, to), gt(channelPrograms.end, from)))
        .orderBy(asc(channelPrograms.channelId), asc(channelPrograms.start))
        .all()
    : [];
  return { now: Date.now(), from, to, channels: shown, programs: programDtos(rows) };
}

function lastEnd(channelId: string) {
  return db.select({ end: channelPrograms.end }).from(channelPrograms).where(eq(channelPrograms.channelId, channelId)).orderBy(desc(channelPrograms.end)).get()?.end ?? 0;
}

function programAt(channelId: string, at: number) {
  return (
    db
      .select()
      .from(channelPrograms)
      .where(and(eq(channelPrograms.channelId, channelId), lte(channelPrograms.start, at), gt(channelPrograms.end, at)))
      .orderBy(desc(channelPrograms.start))
      .get() ?? null
  );
}

/** The first program starting at `at` or later; fillers are skipped, as "next" names what airs after them. */
function programAfter(channelId: string, at: number) {
  return (
    db
      .select()
      .from(channelPrograms)
      .where(and(eq(channelPrograms.channelId, channelId), gte(channelPrograms.start, at), ne(channelPrograms.itemType, "filler")))
      .orderBy(asc(channelPrograms.start))
      .get() ?? null
  );
}

export function channelNow(id: string): ChannelNow | null {
  const channel = getChannel(id);
  if (!channel) return null;
  const now = Date.now();
  const current = programAt(id, now);
  const next = programAfter(id, current ? current.end : now);
  const dtos = programDtos([current, next].filter((row): row is ProgramRow => row != null));
  return {
    now,
    channel,
    current: current ? dtos[0]! : null,
    next: next ? dtos[current ? 1 : 0]! : null,
    offset: current ? (now - current.start) / 1000 : 0,
  };
}

/**
 * Where a viewer tuning in now starts: the program on air and the offset into it. `after` asks for the
 * program airing at that time or later, so a client that finishes a program a moment early moves on.
 * A program whose file cannot be played is replaced on the spot and the channel moves to the next item.
 */
/** `profile` is the watching device's; a file it plays directly is sent as is, like for the browser. */
export function playChannel(id: string, after?: number, profile: CapabilityProfile | EffectiveProfile = BROWSER_PROFILE): LivePlayback | "not_found" | "empty" {
  const row = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!row || !row.enabled) return "not_found";
  if (isIptv(row)) return playIptv(row);
  markWatching(id);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const now = Date.now();
    const at = Math.max(now, after ?? 0);
    if (lastEnd(id) < at + TOP_UP_MARGIN_MS) scheduleChannel(id, { now });
    const program = programAt(id, at);
    if (!program) return "empty";
    if (program.itemType === "filler") return playFiller(row, program, now);
    const described = program.fileId ? describePlayback(program.fileId, profile) : null;
    if (!described || !described.view.plan.available) {
      scheduleChannel(id, { cutAt: program.start, now });
      continue;
    }
    const fileId = described.row.id;
    const offset = Math.max(0, (now - program.start) / 1000);
    const next = programAfter(id, program.end);
    const [programDto, nextDto] = programDtos(next ? [program, next] : [program]);
    const base = { now, channel: getChannel(id)!, program: programDto!, next: nextDto ?? null, offset };
    if (described.view.plan.mode === "direct") {
      return { ...base, mode: "direct", src: `/api/stream/${fileId}`, statusUrl: null, mediaStart: 0, filler: null };
    }
    const duration = described.row.duration ?? Number.POSITIVE_INFINITY;
    let mediaStart = Math.floor(offset / LIVE_SEGMENT) * LIVE_SEGMENT;
    // Early in the program, or when the whole file is converted far enough already, use that conversion.
    if (offset < WHOLE_FILE_BEFORE || wholeTranscodeReach(fileId, described.filePath) >= offset + 10 || mediaStart >= duration - LIVE_SEGMENT) mediaStart = 0;
    else {
      // Another viewer of this program already has a session that starts earlier: join it instead of
      // opening a new one, which would stop theirs (one conversion runs at a time).
      const earlier = sessionStarts(fileId).filter((start) => start > 0 && start <= offset);
      if (earlier.length > 0) mediaStart = Math.max(...earlier);
    }
    const stream = mediaStart > 0 ? `/api/stream/${fileId}/at/${mediaStart}` : `/api/stream/${fileId}`;
    void beginTranscode(fileId, true, mediaStart, described, false, profile).catch(() => undefined);
    return { ...base, mode: "hls", src: `${stream}/index.m3u8`, statusUrl: `${stream}/status`, mediaStart, filler: null };
  }
  return "empty";
}

/** An IPTV channel plays at its live edge through the shared relay; the guide only labels it. */
function playIptv(row: ChannelRow): LivePlayback | "empty" {
  if (!row.streamUrl || row.iptvMissing) return "empty";
  startRelay(row.id, row.streamUrl);
  const now = Date.now();
  const current = programAt(row.id, now);
  const next = programAfter(row.id, current ? current.end : now);
  const dtos = programDtos([current, next].filter((entry): entry is ProgramRow => entry != null));
  const base = `/api/livetv/channels/${row.id}/stream`;
  return {
    now,
    channel: getChannel(row.id)!,
    program: current ? dtos[0]! : null,
    next: next ? dtos[current ? 1 : 0]! : null,
    offset: current ? (now - current.start) / 1000 : 0,
    mode: "live",
    src: `${base}/index.m3u8`,
    statusUrl: `${base}/status`,
    mediaStart: 0,
    filler: null,
  };
}

/** Movie and series ids a channel airs, so its filler shows its own trailers first. */
function ownTitles(channelId: string) {
  const ids = new Set<string>();
  for (const item of resolveSources(sourcesOf(channelId))) {
    if (item.itemType === "movie") ids.add(item.itemId);
    else if (item.group.startsWith("series:")) ids.add(item.group.slice("series:".length));
  }
  return ids;
}

/** The gap before an aligned start: the client shows clips or the "Up next" card until it ends. */
function playFiller(row: ChannelRow, program: ProgramRow, now: number): LivePlayback {
  const next = programAfter(row.id, program.end);
  const [programDto, nextDto] = programDtos(next ? [program, next] : [program]);
  const kind = fillerOf(row);
  const types = libraryTypes();
  const filler = fillerFor({
    kind,
    ownTitles: kind === "media" ? ownTitles(row.id) : new Set(),
    music: isMusicChannel(sourcesOf(row.id), (libraryId) => types.get(libraryId)),
    seed: (row.seed ^ Math.floor(program.start / 1000)) >>> 0,
    seconds: (program.end - now) / 1000,
    now,
  });
  return {
    now,
    channel: getChannel(row.id)!,
    program: programDto!,
    next: nextDto ?? null,
    offset: Math.max(0, (now - program.start) / 1000),
    mode: "filler",
    src: "",
    statusUrl: null,
    mediaStart: 0,
    filler,
  };
}

/** A player keeps its channel marked as watched, which is what pre-transcoding looks at. */
export function watchChannel(id: string) {
  const row = db.select({ kind: channels.kind, enabled: channels.enabled }).from(channels).where(eq(channels.id, id)).get();
  if (!row || !row.enabled) return false;
  if (!isIptv(row)) markWatching(id);
  return true;
}

/** Files found not worth preparing (direct play, already converted, failing); looked at again later. */
const notPreparable = new Map<string, number>();
const RECHECK_MS = 10 * 60_000;

/**
 * Runs every few seconds: converts the next program of a watched channel ahead of its start, stops
 * conversions nobody is going to watch, and replaces upcoming programs whose files went missing.
 */
export function prepareUpcoming(now = Date.now()) {
  if (!liveTvSettings().prepareNext) return;
  const upcoming: UpcomingProgram[] = [];
  const recent: UpcomingProgram[] = [];
  for (const channelId of watchedChannels(now)) {
    const next = db
      .select({ start: channelPrograms.start, fileId: channelPrograms.fileId })
      .from(channelPrograms)
      .where(and(eq(channelPrograms.channelId, channelId), gt(channelPrograms.start, now), ne(channelPrograms.itemType, "filler"), isNotNull(channelPrograms.fileId)))
      .orderBy(asc(channelPrograms.start))
      .get();
    if (next?.fileId) upcoming.push({ channelId, start: next.start, fileId: next.fileId });
    const current = programAt(channelId, now);
    if (current?.fileId) recent.push({ channelId, start: current.start, fileId: current.fileId });
  }
  for (const [fileId, until] of notPreparable) if (until <= now) notPreparable.delete(fileId);
  const decision = decidePrepare({
    now,
    upcoming: upcoming.filter((program) => !notPreparable.has(program.fileId)),
    recent,
    foregroundBusy: hasForegroundTranscode(),
  });
  for (const fileId of backgroundTranscodes()) if (!decision.keep.has(fileId)) stopBackgroundTranscode(fileId);
  const target = decision.start;
  if (!target || backgroundTranscodes().includes(target.fileId)) return;
  const described = describePlayback(target.fileId);
  if (!described || !described.view.plan.available) {
    // Found ahead of time: the channel moves on to its next item before anyone tunes in to this one.
    scheduleChannel(target.channelId, { cutAt: target.start, now });
    return;
  }
  if (described.view.plan.mode === "direct" || wholeTranscodeReach(target.fileId, described.filePath) === Number.POSITIVE_INFINITY) {
    notPreparable.set(target.fileId, now + RECHECK_MS);
    return;
  }
  void beginTranscode(target.fileId, false, 0, described, true)
    .then((opened) => {
      if (!opened || opened.status.state !== "running") notPreparable.set(target.fileId, Date.now() + RECHECK_MS);
    })
    .catch(() => notPreparable.set(target.fileId, Date.now() + RECHECK_MS));
}
