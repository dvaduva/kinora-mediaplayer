import fs from "node:fs";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import type { ChannelInput, ChannelNow, ChannelOrder, ChannelProgram, ChannelSource, LiveChannel, LivePlayback, ProgramItemType } from "@kinora/shared";
import { isChannelSourceType } from "@kinora/shared";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { channelPrograms, channels, channelSources, episodes, mediaFiles, movies } from "../db/schema.js";
import { dataDir } from "../paths.js";
import { beginTranscode, describePlayback, wholeTranscodeReach } from "../playback/session.js";
import { sessionStarts } from "../playback/transcode.js";
import { resolveSources } from "./sources.js";
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

function channelDto(row: ChannelRow, until: Map<string, number>): LiveChannel {
  return {
    id: row.id,
    kind: row.kind === "iptv" ? "iptv" : "virtual",
    number: row.number,
    name: row.name,
    logoUrl: row.logoPath ? `/api/livetv/channels/${row.id}/logo?v=${row.updatedAt}` : null,
    orderMode: row.orderMode === "sequential" ? "sequential" : "shuffle",
    enabled: row.enabled,
    sources: sourcesOf(row.id),
    empty: !until.has(row.id),
  };
}

export function listChannels(): LiveChannel[] {
  const until = scheduledUntil();
  return db
    .select()
    .from(channels)
    .orderBy(asc(channels.number), asc(channels.name))
    .all()
    .map((row) => channelDto(row, until));
}

/** Channels the guide and the player show: enabled and with something to air. */
export function visibleChannels() {
  return listChannels().filter((channel) => channel.enabled && !channel.empty);
}

export function getChannel(id: string): LiveChannel | null {
  const row = db.select().from(channels).where(eq(channels.id, id)).get();
  return row ? channelDto(row, scheduledUntil()) : null;
}

function programDtos(rows: ProgramRow[]): ChannelProgram[] {
  const episodeIds = [...new Set(rows.filter((row) => row.itemType === "episode" && row.itemId).map((row) => row.itemId!))];
  const movieIds = [...new Set(rows.filter((row) => row.itemType === "movie" && row.itemId).map((row) => row.itemId!))];
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
  if (!channel) return;
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
  for (const channel of db.select().from(channels).where(eq(channels.enabled, true)).all()) {
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
  return { name, number, orderMode, enabled, sources };
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

export function createChannel(input: ChannelInput) {
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
      categoryOverride: null,
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
  db.update(channels)
    .set({ name: input.name, number: input.number, orderMode: input.orderMode, enabled: input.enabled, updatedAt: now })
    .where(eq(channels.id, id))
    .run();
  writeSources(id, input.sources);
  // The program on air keeps running; everything after it follows the new rules.
  scheduleChannel(id, { cutAt: now, now });
  return getChannel(id);
}

export function regenerateChannel(id: string) {
  if (!db.select({ id: channels.id }).from(channels).where(eq(channels.id, id)).get()) return null;
  const now = Date.now();
  scheduleChannel(id, { cutAt: now, now });
  return getChannel(id);
}

function removeLogoFile(name: string | null) {
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
  db.delete(channels).where(eq(channels.id, id)).run();
  removeLogoFile(row.logoPath);
  return true;
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

export function channelLogoFile(id: string) {
  const row = db.select({ logoPath: channels.logoPath }).from(channels).where(eq(channels.id, id)).get();
  if (!row?.logoPath) return null;
  const file = path.join(logoDir, path.basename(row.logoPath));
  return fs.existsSync(file) ? file : null;
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

function programAfter(channelId: string, at: number) {
  return (
    db
      .select()
      .from(channelPrograms)
      .where(and(eq(channelPrograms.channelId, channelId), gte(channelPrograms.start, at)))
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
export function playChannel(id: string, after?: number): LivePlayback | "not_found" | "empty" {
  const row = db.select().from(channels).where(eq(channels.id, id)).get();
  if (!row || !row.enabled) return "not_found";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const now = Date.now();
    const at = Math.max(now, after ?? 0);
    if (lastEnd(id) < at + TOP_UP_MARGIN_MS) scheduleChannel(id, { now });
    const program = programAt(id, at);
    if (!program) return "empty";
    const described = program.fileId ? describePlayback(program.fileId) : null;
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
      return { ...base, mode: "direct", src: `/api/stream/${fileId}`, statusUrl: null, mediaStart: 0 };
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
    void beginTranscode(fileId, true, mediaStart, described).catch(() => undefined);
    return { ...base, mode: "hls", src: `${stream}/index.m3u8`, statusUrl: `${stream}/status`, mediaStart };
  }
  return "empty";
}
