import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TranscodeStatus } from "@kinora/shared";
import { dataDir } from "../paths.js";
import { bins, run, tools } from "../process.js";
import { DEFAULT_CACHE_GB, gigabytes, listCache, markUsed, MAX_CACHE_AGE_MS, pruneCache } from "./cache.js";

export interface TranscodeRequest {
  fileId: string;
  sourcePath: string;
  size: number;
  mtime: number;
  duration: number | null;
  copyVideo: boolean;
  copyAudio: boolean;
  /** Embedded text subtitle streams written as WebVTT while the same pass reads the file. */
  subtitleStreams?: number[];
}

export interface HlsCodecs {
  copyVideo: boolean;
  copyAudio: boolean;
  /** ffmpeg H.264 encoder; libx264 by default, or e.g. h264_nvenc / h264_qsv / h264_amf. */
  videoEncoder?: string;
}

const SEGMENT_SECONDS = 4;

export function videoEncoder(value = process.env.KINORA_VIDEO_ENCODER) {
  const encoder = (value ?? "").trim();
  return /^[\w-]+$/.test(encoder) ? encoder : "libx264";
}

export function videoEncodeArgs(encoder: string) {
  const quality =
    encoder === "libx264"
      ? ["-preset", "veryfast", "-crf", "21", "-profile:v", "high"]
      : ["-b:v", "8M", "-maxrate", "10M", "-bufsize", "16M"];
  return [
    "-c:v",
    encoder,
    ...quality,
    // Browsers decode 8-bit 4:2:0 H.264 everywhere; keep at most 1080p so a CPU encoder stays ahead of playback.
    "-vf",
    "scale='min(1920,iw)':-2:flags=bicubic,format=yuv420p",
    // Keyframes on segment boundaries keep every segment independently playable.
    "-force_key_frames",
    `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    ...(encoder === "libx264" ? ["-sc_threshold", "0"] : []),
  ];
}

interface Job {
  state: "running" | "error";
  /** Media time where this ffmpeg run started; its subtitle files count from here. */
  runStart: number;
  seconds: number;
  error: string | null;
  child: ChildProcess | null;
}

const jobs = new Map<string, Job>();
const sessions = new Map<string, TranscodeRequest>();

export const transcodeRoot = path.join(dataDir, "cache", "transcode");
let cacheLimitBytes = gigabytes(DEFAULT_CACHE_GB);

export function transcodeLocation(input: Pick<TranscodeRequest, "fileId" | "size" | "mtime">) {
  const key = `${input.fileId}-${input.size}-${input.mtime}`;
  const dir = path.join(transcodeRoot, key);
  return { key, dir };
}

export function setTranscodeCacheLimit(bytes: number) {
  if (Number.isFinite(bytes) && bytes >= 0) cacheLimitBytes = bytes;
}

function activeTranscodeKeys() {
  const keys = new Set<string>();
  for (const input of sessions.values()) keys.add(transcodeLocation(input).key);
  for (const [key, job] of jobs) if (job.state === "running") keys.add(key);
  return keys;
}

/** Drops old and least recently watched conversions; the open session and running encoders stay. */
export function pruneTranscodes(maxBytes = cacheLimitBytes) {
  return pruneCache(transcodeRoot, { maxBytes, maxAgeMs: MAX_CACHE_AGE_MS, protectedKeys: activeTranscodeKeys() });
}

export function transcodeCacheUsage() {
  return listCache(transcodeRoot).reduce((sum, entry) => sum + entry.bytes, 0);
}

export interface HlsResume {
  seek: number;
  startNumber: number;
}

export function subtitleRunFile(directory: string, streamIndex: number, runStart: number) {
  return path.join(directory, `sub${streamIndex}_${Math.round(runStart * 1000)}.vtt`);
}

function subtitleShiftFile(directory: string, runStart: number) {
  return path.join(directory, `subshift_${Math.round(runStart * 1000)}.txt`);
}

/** Latest video keyframe at or before `seconds`, read from the packets just before it. */
export function keyframeBefore(packetsCsv: string, seconds: number) {
  let best: number | null = null;
  for (const line of packetsCsv.split(/\r?\n/)) {
    const [pts, flags] = line.trim().split(",");
    const time = Number(pts);
    if (!flags?.includes("K") || !Number.isFinite(time) || time > seconds + 0.001) continue;
    if (best == null || time > best) best = time;
  }
  return best;
}

/**
 * A resumed pass that copies the video starts at the keyframe before the seek point, while the
 * playlist places it at the seek point; the video then runs (seek - keyframe) seconds late, and
 * the subtitles of that pass must be shifted by the same amount.
 */
async function copiedVideoLag(source: string, seek: number) {
  if (!tools.ffprobe) return 0;
  const from = Math.max(0, seek - 20);
  const result = await run(
    bins.ffprobe,
    ["-v", "error", "-select_streams", "v:0", "-read_intervals", `${from.toFixed(3)}%${(seek + 0.5).toFixed(3)}`, "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", source],
    30_000,
  ).catch(() => null);
  const keyframe = result?.code === 0 ? keyframeBefore(result.stdout, seek) : null;
  return keyframe == null ? 0 : Math.max(0, Math.min(20, seek - keyframe));
}

export function hlsArgs(source: string, directory: string, codecs: HlsCodecs, resume?: HlsResume, subtitleStreams: number[] = []) {
  const { copyVideo, copyAudio } = codecs;
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-nostats",
    "-progress",
    "pipe:1",
    "-y",
    "-fflags",
    "+genpts",
    ...(resume ? ["-ss", resume.seek.toFixed(3)] : []),
    "-i",
    source,
    "-avoid_negative_ts",
    "make_zero",
    "-map",
    "0:v:0",
    "-map",
    copyAudio ? "0:a:0?" : "0:a:0",
    "-sn",
    "-dn",
    ...(copyVideo ? ["-c:v", "copy"] : videoEncodeArgs(codecs.videoEncoder ?? "libx264")),
    ...(copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k"]),
    "-f",
    "hls",
    "-hls_time",
    String(SEGMENT_SECONDS),
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "event",
    "-hls_flags",
    resume ? "independent_segments+temp_file+append_list" : "independent_segments+temp_file",
    ...(resume ? ["-start_number", String(resume.startNumber)] : []),
    "-hls_segment_filename",
    path.join(directory, "seg%05d.ts"),
    path.join(directory, "index.m3u8"),
    // Extra outputs of the same pass: subtitles come out as the file is read, without a second read.
    // Their timestamps count from the seek point; the file name records it.
    ...subtitleStreams.flatMap((streamIndex) => [
      "-map",
      `0:${streamIndex}`,
      "-c:s",
      "webvtt",
      "-flush_packets",
      "1",
      "-f",
      "webvtt",
      subtitleRunFile(directory, streamIndex, resume?.seek ?? 0),
    ]),
  ];
}

export function parseClock(value: string) {
  const match = /^(?:(\d+):)?(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function consumeProgress(buffer: string, chunk: string) {
  const lines = (buffer + chunk).split(/\r?\n/);
  const rest = lines.pop() ?? "";
  let seconds: number | null = null;
  for (const line of lines) {
    if (!line.startsWith("out_time=")) continue;
    const parsed = parseClock(line.slice("out_time=".length));
    if (parsed != null) seconds = parsed;
  }
  return { rest, seconds };
}

export function playlistForClient(contents: string) {
  const lines: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^\uFEFF/, "");
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      lines.push(trimmed);
      continue;
    }
    const name = trimmed.split(/[/\\]/).pop() ?? "";
    if (/^seg\d+\.ts$/.test(name)) lines.push(name);
  }
  return `${lines.join("\n")}\n`;
}

export function playlistHasSegment(contents: string) {
  return contents.split(/\r?\n/).some((line) => /^seg\d+\.ts$/.test(line.trim().split(/[/\\]/).pop() ?? ""));
}

export function playlistCursor(contents: string) {
  let seconds = 0;
  let count = 0;
  let nextNumber = 0;
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    const info = /^#EXTINF:([\d.]+)/.exec(trimmed);
    if (info) seconds += Number(info[1]);
    const segment = /^seg(\d+)\.ts$/.exec(trimmed.split(/[/\\]/).pop() ?? "");
    if (!segment) continue;
    count += 1;
    nextNumber = Math.max(nextNumber, Number(segment[1]) + 1);
  }
  return { seconds, count, nextNumber };
}

export function prepareAppendPlaylist(contents: string) {
  const lines = contents.split(/\r?\n/).filter((line) => line.trim() !== "#EXT-X-ENDLIST");
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  if (lines[lines.length - 1]?.trim() !== "#EXT-X-DISCONTINUITY") lines.push("#EXT-X-DISCONTINUITY");
  return `${lines.join("\n")}\n`;
}

function coversDuration(seconds: number, duration: number | null) {
  return duration != null && seconds >= duration - 20;
}

function progressValue(state: TranscodeStatus["state"], seconds: number, duration: number | null) {
  if (state === "error") return null;
  if (state === "ready") return 1;
  if (duration == null || duration <= 0) return null;
  return Math.max(0, Math.min(0.99, seconds / duration));
}

function readPlaylist(dir: string) {
  try {
    return fs.readFileSync(path.join(dir, "index.m3u8"), "utf8");
  } catch {
    return "";
  }
}

function segmentFiles(dir: string) {
  try {
    return fs.readdirSync(dir).filter((name) => /^seg\d+\.ts$/.test(name));
  } catch {
    return [];
  }
}

function statusFor(state: TranscodeStatus["state"], seconds: number, duration: number | null, playlist: boolean, error: string | null): TranscodeStatus {
  return {
    state,
    seconds,
    duration,
    progress: progressValue(state, seconds, duration),
    playlist,
    error,
  };
}

function readyStatus(duration: number | null): TranscodeStatus {
  return statusFor("ready", duration ?? 0, duration, true, null);
}

export function hasOtherTranscode(fileId: string) {
  for (const otherId of sessions.keys()) {
    if (otherId !== fileId) return true;
  }
  return false;
}

export function lookupTranscode(fileId: string, probePlaylist = true): { status: TranscodeStatus; dir: string } | null {
  const input = sessions.get(fileId);
  if (!input) return null;
  const { key, dir } = transcodeLocation(input);
  if (fs.existsSync(path.join(dir, "done"))) return { status: readyStatus(input.duration), dir };
  const job = jobs.get(key);
  if (job?.state === "running") {
    const playlist = probePlaylist ? playlistHasSegment(readPlaylist(dir)) : false;
    return { status: statusFor("running", job.seconds, input.duration, playlist, null), dir };
  }
  if (job?.state === "error") return { status: statusFor("error", job.seconds, input.duration, false, job.error), dir };
  return null;
}

function stopOtherJobs(fileId: string) {
  for (const [otherId, input] of sessions) {
    if (otherId === fileId) continue;
    const located = transcodeLocation(input);
    const job = jobs.get(located.key);
    jobs.delete(located.key);
    sessions.delete(otherId);
    job?.child?.kill();
  }
}

export function stopOrphanEncoders() {
  if (process.platform !== "win32") return;
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name = 'ffmpeg.exe'\" | Where-Object { $_.CommandLine -match 'hls_playlist_type' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
}

function tail(text: string) {
  const line = text.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
  return line.slice(0, 300);
}

export async function ensureTranscode(input: TranscodeRequest, restartError = false): Promise<{ status: TranscodeStatus; dir: string }> {
  sessions.set(input.fileId, input);
  const { key, dir } = transcodeLocation(input);
  const done = path.join(dir, "done");
  if (fs.existsSync(done)) {
    markUsed(dir);
    return { status: readyStatus(input.duration), dir };
  }
  const existing = jobs.get(key);
  if (existing?.state === "running") {
    return { status: statusFor("running", existing.seconds, input.duration, playlistHasSegment(readPlaylist(dir)), null), dir };
  }
  if (existing?.state === "error" && !restartError) {
    return { status: statusFor("error", existing.seconds, input.duration, false, existing.error), dir };
  }

  const existingPlaylist = readPlaylist(dir);
  const cursor = playlistCursor(existingPlaylist);
  if (cursor.count > 0 && coversDuration(cursor.seconds, input.duration)) {
    fs.writeFileSync(done, "");
    return { status: readyStatus(input.duration), dir };
  }

  stopOtherJobs(input.fileId);
  const job: Job = { state: "running", runStart: cursor.count > 0 ? cursor.seconds : 0, seconds: cursor.count > 0 ? cursor.seconds : 0, error: null, child: null };
  jobs.set(key, job);
  const resume = cursor.count > 0 ? { seek: cursor.seconds, startNumber: cursor.nextNumber } : undefined;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    if (resume) {
      fs.writeFileSync(path.join(dir, "index.m3u8"), prepareAppendPlaylist(existingPlaylist));
    } else if (segmentFiles(dir).length === 0) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      await fs.promises.mkdir(dir, { recursive: true });
    } else {
      job.state = "error";
      job.error = "partial cache has no playlist";
      return { status: statusFor("error", 0, input.duration, false, job.error), dir };
    }
    markUsed(dir);
    // Make room before a new conversion starts writing; this session is protected.
    pruneTranscodes();
  } catch (error) {
    job.state = "error";
    job.error = error instanceof Error ? error.message : "cache";
    return { status: statusFor("error", 0, input.duration, false, job.error), dir };
  }
  if (jobs.get(key) !== job) return { status: statusFor("running", job.seconds, input.duration, Boolean(resume), null), dir };
  if (resume && input.copyVideo && input.subtitleStreams?.length) {
    const lag = await copiedVideoLag(input.sourcePath, resume.seek);
    if (lag > 0) fs.writeFileSync(subtitleShiftFile(dir, resume.seek), String(lag));
    if (jobs.get(key) !== job) return { status: statusFor("running", job.seconds, input.duration, true, null), dir };
  }

  const child = spawn(bins.ffmpeg, hlsArgs(
      input.sourcePath,
      dir,
      { copyVideo: input.copyVideo, copyAudio: input.copyAudio, videoEncoder: videoEncoder() },
      resume,
      input.subtitleStreams,
    ), {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;
  let stdout = "";
  let stderr = "";
  const origin = resume?.seek ?? 0;
  let progressMode: "unknown" | "relative" | "absolute" = origin > 1 ? "unknown" : "relative";

  const fail = (message: string) => {
    if (jobs.get(key) !== job || job.state !== "running") return;
    job.state = "error";
    job.error = message.slice(0, 300) || "ffmpeg failed";
    job.child = null;
    if (!resume) void fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  };

  child.stdout.on("data", (chunk: Buffer) => {
    const parsed = consumeProgress(stdout, chunk.toString());
    stdout = parsed.rest;
    if (parsed.seconds != null && jobs.get(key) === job) {
      if (progressMode === "unknown") progressMode = parsed.seconds + 1 < origin ? "relative" : "absolute";
      job.seconds = progressMode === "relative" ? origin + parsed.seconds : parsed.seconds;
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  child.on("error", (error) => fail(error.message));
  child.on("close", (code) => {
    if (jobs.get(key) !== job || job.state !== "running") return;
    const covered = input.duration == null || job.seconds >= input.duration - 20;
    if (code === 0 && playlistHasSegment(readPlaylist(dir)) && covered) {
      fs.writeFileSync(done, "");
      markUsed(dir);
      jobs.delete(key);
      pruneTranscodes();
      return;
    }
    fail(tail(stderr) || `ffmpeg exited with ${code ?? "no code"}`);
  });

  return { status: statusFor("running", job.seconds, input.duration, Boolean(resume), null), dir };
}

export interface SubtitleRun {
  file: string;
  /** Media time where the run starts covering. */
  start: number;
  /** Add to the run's subtitle timestamps to place them on the playlist timeline. */
  offset: number;
  /** Media time up to which the run has read the file. */
  end: number;
  /** The run is still reading, so `end` keeps growing. */
  live: boolean;
}

/**
 * Subtitle files written by the conversion passes of a file, oldest first. Each resumed pass starts
 * where the playlist ended, so a run covers the time up to the next run's start.
 */
export function transcodeSubtitleRuns(fileId: string, streamIndex: number): SubtitleRun[] {
  const input = sessions.get(fileId);
  if (!input) return [];
  const { key, dir } = transcodeLocation(input);
  const prefix = `sub${streamIndex}_`;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const starts = names
    .filter((name) => name.startsWith(prefix) && /^\d+\.vtt$/.test(name.slice(prefix.length)))
    .map((name) => Number(name.slice(prefix.length, -".vtt".length)) / 1000)
    .sort((a, b) => a - b);
  if (starts.length === 0) return [];
  const done = fs.existsSync(path.join(dir, "done"));
  const job = jobs.get(key);
  return starts.map((start, index) => {
    const file = subtitleRunFile(dir, streamIndex, start);
    let shift = 0;
    try {
      shift = Number(fs.readFileSync(subtitleShiftFile(dir, start), "utf8")) || 0;
    } catch {
      // Not resumed, or the video was encoded and starts exactly at the seek point.
    }
    const base = { file, start, offset: start + shift };
    const next = starts[index + 1];
    if (next != null) return { ...base, end: next, live: false };
    if (done) return { ...base, end: Number.POSITIVE_INFINITY, live: false };
    if (job?.state === "running" && Math.abs(job.runStart - start) < 0.01) return { ...base, end: job.seconds, live: true };
    return { ...base, end: playlistCursor(readPlaylist(dir)).seconds, live: false };
  });
}

export function discardTranscode(input: Pick<TranscodeRequest, "fileId" | "size" | "mtime">) {
  const { key, dir } = transcodeLocation(input);
  const job = jobs.get(key);
  jobs.delete(key);
  sessions.delete(input.fileId);
  job?.child?.kill();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // The encoder may still be releasing the cache directory.
  }
}
