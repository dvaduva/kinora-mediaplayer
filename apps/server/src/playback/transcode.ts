import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TranscodeStatus } from "@kinora/shared";
import { dataDir } from "../paths.js";
import { bins } from "../process.js";

export interface TranscodeRequest {
  fileId: string;
  sourcePath: string;
  size: number;
  mtime: number;
  duration: number | null;
  copyVideo: boolean;
  copyAudio: boolean;
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
  seconds: number;
  error: string | null;
  child: ChildProcess | null;
}

const jobs = new Map<string, Job>();
const sessions = new Map<string, TranscodeRequest>();

export function transcodeLocation(input: Pick<TranscodeRequest, "fileId" | "size" | "mtime">) {
  const key = `${input.fileId}-${input.size}-${input.mtime}`;
  const dir = path.join(dataDir, "cache", "transcode", key);
  return { key, dir };
}

export interface HlsResume {
  seek: number;
  startNumber: number;
}

export function hlsArgs(source: string, directory: string, codecs: HlsCodecs, resume?: HlsResume) {
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
  if (fs.existsSync(done)) return { status: readyStatus(input.duration), dir };
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
  const job: Job = { state: "running", seconds: cursor.count > 0 ? cursor.seconds : 0, error: null, child: null };
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
  } catch (error) {
    job.state = "error";
    job.error = error instanceof Error ? error.message : "cache";
    return { status: statusFor("error", 0, input.duration, false, job.error), dir };
  }
  if (jobs.get(key) !== job) return { status: statusFor("running", job.seconds, input.duration, Boolean(resume), null), dir };

  const child = spawn(bins.ffmpeg, hlsArgs(
      input.sourcePath,
      dir,
      { copyVideo: input.copyVideo, copyAudio: input.copyAudio, videoEncoder: videoEncoder() },
      resume,
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
      jobs.delete(key);
      return;
    }
    fail(tail(stderr) || `ffmpeg exited with ${code ?? "no code"}`);
  });

  return { status: statusFor("running", job.seconds, input.duration, Boolean(resume), null), dir };
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
