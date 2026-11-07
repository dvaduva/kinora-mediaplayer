import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { SubtitleChunk, SubtitleCue } from "@kinora/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaFiles, subtitleAssets } from "../db/schema.js";
import { dataDir } from "../paths.js";
import { bins, run, tools } from "../process.js";
import { CHUNK_SECONDS, cuesInChunk, parseVtt } from "./cues.js";
import { decodeSubtitle, ensureVtt, romanianOrthography, srtToVtt } from "./srt.js";
import { transcodeSubtitleRuns } from "./transcode.js";

type SubtitleAsset = typeof subtitleAssets.$inferSelect;
type MediaFile = typeof mediaFiles.$inferSelect;

const TEXT_CODECS = new Set(["srt", "vtt", "subrip", "ass", "ssa", "mov_text", "webvtt", "text"]);
// Cues that begin a little before a window can still be on screen when it starts.
const WINDOW_LEAD_SECONDS = 10;
// Only one window reads at a time, so a slow network share gets the whole link for it.
const WINDOW_TIMEOUT_MS = 5 * 60_000;

const subtitleCache = path.join(dataDir, "cache", "subtitles");

function isTextBased(asset: SubtitleAsset) {
  return TEXT_CODECS.has((asset.codec ?? "").toLowerCase());
}

function localize(asset: SubtitleAsset, text: string) {
  return asset.language === "ro" ? romanianOrthography(text) : text;
}

function nonEmpty(file: string) {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

/** Stream indexes of the embedded text subtitles, for the conversion pass to write alongside the video. */
export function embeddedTextStreams(fileId: string) {
  return db
    .select()
    .from(subtitleAssets)
    .where(and(eq(subtitleAssets.fileId, fileId), eq(subtitleAssets.origin, "embedded")))
    .all()
    .filter((asset) => isTextBased(asset) && asset.streamIndex != null)
    .map((asset) => asset.streamIndex as number);
}

/** Whole-file conversion of an external subtitle file; embedded tracks go through `subtitleChunk`. */
export async function materializeSubtitle(asset: SubtitleAsset, videoPath: string) {
  const codec = (asset.codec ?? "").toLowerCase();
  if (!isTextBased(asset)) throw new Error("bitmap");
  if (asset.origin === "embedded" || !asset.path) throw new Error("chunked");
  const stat = fs.statSync(asset.path);
  const destination = path.join(subtitleCache, `${asset.id}-${stat.size}-${Math.round(stat.mtimeMs)}.vtt`);
  if (nonEmpty(destination)) return destination;
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (codec === "srt" || codec === "subrip" || codec === "vtt" || codec === "webvtt") {
    const decoded = decodeSubtitle(fs.readFileSync(asset.path));
    const vtt = codec === "vtt" || codec === "webvtt" ? ensureVtt(decoded) : srtToVtt(decoded);
    fs.writeFileSync(destination, localize(asset, vtt), "utf8");
    return destination;
  }

  if (!tools.ffmpeg) throw new Error("needs_ffmpeg");
  const temp = `${destination}.${process.pid}.part`;
  try {
    const result = await run(bins.ffmpeg, ["-nostdin", "-y", "-i", asset.path, "-f", "webvtt", temp], 60_000);
    if (result.code !== 0 || !nonEmpty(temp)) throw new Error("extract_failed");
    fs.renameSync(temp, destination);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return destination;
}

function chunkCacheFile(asset: SubtitleAsset, file: MediaFile, index: number) {
  return path.join(subtitleCache, "chunks", `${asset.id}-${file.size}-${file.mtime}`, `${index}.json`);
}

/**
 * The cues of an embedded track that start inside one window of media time. A conversion pass that
 * already reads the file supplies them for free; otherwise ffmpeg seeks to the window and reads only it.
 * `signal` aborts when the player no longer needs the window.
 */
export async function subtitleChunk(asset: SubtitleAsset, file: MediaFile, index: number, signal?: AbortSignal): Promise<SubtitleChunk> {
  if (!isTextBased(asset)) throw new Error("bitmap");
  if (asset.origin !== "embedded" || asset.streamIndex == null) throw new Error("not_embedded");
  if (!tools.ffmpeg) throw new Error("needs_ffmpeg");
  const from = index * CHUNK_SECONDS;
  const to = from + CHUNK_SECONDS;
  if (file.duration != null && from > file.duration + 1) return { cues: [], complete: true };

  // 1. The conversion pass writes every embedded text track while it reads the file.
  const covering = transcodeSubtitleRuns(file.id, asset.streamIndex).find((entry) => entry.start <= from + 0.5 && (entry.live || entry.end >= to));
  if (covering) {
    const text = fs.existsSync(covering.file) ? fs.readFileSync(covering.file, "utf8") : "";
    const complete = covering.end >= to || (file.duration != null && covering.end >= file.duration);
    const cues = cuesInChunk(parseVtt(text, covering.live), index, covering.offset);
    return { cues: cues.map((cue) => ({ ...cue, text: localize(asset, cue.text) })), complete };
  }

  // 2. A window read earlier.
  const cacheFile = chunkCacheFile(asset, file, index);
  try {
    return { cues: JSON.parse(fs.readFileSync(cacheFile, "utf8")) as SubtitleCue[], complete: true };
  } catch {
    // Not read yet.
  }

  // 3. Seek and read only this window.
  const cues = await queueWindow(cacheFile, () => windowArgs(asset, file.path, index), signal);
  const placed = cuesInChunk(parseVtt(cues), index).map((cue) => ({ ...cue, text: localize(asset, cue.text) }));
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(placed), "utf8");
  return { cues: placed, complete: true };
}

function windowArgs(asset: SubtitleAsset, videoPath: string, index: number) {
  const from = index * CHUNK_SECONDS;
  const seek = Math.max(0, from - WINDOW_LEAD_SECONDS);
  // -copyts keeps the file's own timestamps; the output-side -to stops reading after the window.
  return [
    "-nostdin",
    "-v",
    "error",
    ...(seek > 0 ? ["-ss", seek.toFixed(3)] : []),
    "-copyts",
    "-i",
    videoPath,
    "-map",
    `0:${asset.streamIndex}`,
    "-to",
    (from + CHUNK_SECONDS).toFixed(3),
    "-c:s",
    "webvtt",
    "-f",
    "webvtt",
    "pipe:1",
  ];
}

interface WindowRead {
  key: string;
  args: () => string[];
  waiters: number;
  child: ChildProcess | null;
  promise: Promise<string>;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

// Window reads share the link to the file with the video stream itself, so only one runs at a time.
// The newest request goes first: it is where the viewer is now; older ones are usually seeked past.
const windowReads = new Map<string, WindowRead>();
const waiting: WindowRead[] = [];
let running: WindowRead | null = null;

function queueWindow(key: string, args: () => string[], signal?: AbortSignal) {
  let read = windowReads.get(key);
  if (!read) {
    let resolve!: (text: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    read = { key, args, waiters: 0, child: null, promise, resolve, reject };
    promise.catch(() => undefined);
    windowReads.set(key, read);
    waiting.push(read);
  } else if (read !== running) {
    // Asked again: move it to the front.
    waiting.splice(waiting.indexOf(read), 1);
    waiting.push(read);
  }
  const entry = read;
  entry.waiters += 1;
  signal?.addEventListener("abort", () => leave(entry), { once: true });
  pump();
  return entry.promise;
}

function leave(read: WindowRead) {
  read.waiters -= 1;
  if (read.waiters > 0) return;
  windowReads.delete(read.key);
  const queued = waiting.indexOf(read);
  if (queued >= 0) waiting.splice(queued, 1);
  read.child?.kill();
  read.reject(new Error("aborted"));
}

function pump() {
  if (running || waiting.length === 0) return;
  const read = waiting.pop() as WindowRead;
  running = read;
  const child = spawn(bins.ffmpeg, read.args(), { windowsHide: true });
  read.child = child;
  let stdout = "";
  const timer = setTimeout(() => child.kill(), WINDOW_TIMEOUT_MS);
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.resume();
  const finish = (error: Error | null) => {
    clearTimeout(timer);
    if (running === read) running = null;
    if (windowReads.get(read.key) === read) windowReads.delete(read.key);
    // A killed read is partial; it must not be cached as the whole window.
    if (error) read.reject(error);
    else read.resolve(stdout);
    pump();
  };
  child.on("error", (error) => finish(error));
  child.on("close", (code) => finish(code === 0 ? null : new Error("extract_failed")));
}
