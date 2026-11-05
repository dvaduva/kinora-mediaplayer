import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TranscodeStatus } from "@kinora/shared";
import { dataDir } from "../paths.js";

export interface TranscodeRequest {
  fileId: string;
  sourcePath: string;
  size: number;
  mtime: number;
  duration: number | null;
  copyAudio: boolean;
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

export function hlsArgs(source: string, directory: string, copyAudio: boolean) {
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
    "-c:v",
    "copy",
    ...(copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192k"]),
    "-f",
    "hls",
    "-hls_time",
    "4",
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "event",
    "-hls_flags",
    "independent_segments+temp_file",
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

async function dropOtherCaches(fileId: string, key: string) {
  const root = path.join(dataDir, "cache", "transcode");
  if (!fs.existsSync(root)) return;
  for (const [otherKey, job] of jobs) {
    if (!otherKey.startsWith(`${fileId}-`) || otherKey === key) continue;
    job.child?.kill();
    jobs.delete(otherKey);
  }
  await Promise.all(
    fs.readdirSync(root)
      .filter((entry) => entry.startsWith(`${fileId}-`) && entry !== key)
      .map((entry) => fs.promises.rm(path.join(root, entry), { recursive: true, force: true })),
  );
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
    await dropOtherCaches(input.fileId, key);
    return { status: readyStatus(input.duration), dir };
  }
  const existing = jobs.get(key);
  if (existing?.state === "running") {
    return { status: statusFor("running", existing.seconds, input.duration, playlistHasSegment(readPlaylist(dir)), null), dir };
  }
  if (existing?.state === "error" && !restartError) {
    return { status: statusFor("error", existing.seconds, input.duration, false, existing.error), dir };
  }

  stopOtherJobs(input.fileId);
  const job: Job = { state: "running", seconds: 0, error: null, child: null };
  jobs.set(key, job);
  try {
    await dropOtherCaches(input.fileId, key);
    await fs.promises.rm(dir, { recursive: true, force: true });
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (error) {
    job.state = "error";
    job.error = error instanceof Error ? error.message : "cache";
    return { status: statusFor("error", 0, input.duration, false, job.error), dir };
  }
  if (jobs.get(key) !== job) return { status: statusFor("running", 0, input.duration, false, null), dir };

  const child = spawn("ffmpeg", hlsArgs(input.sourcePath, dir, input.copyAudio), {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;
  let stdout = "";
  let stderr = "";

  const fail = (message: string) => {
    if (jobs.get(key) !== job || job.state !== "running") return;
    job.state = "error";
    job.error = message.slice(0, 300) || "ffmpeg failed";
    job.child = null;
    void fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  };

  child.stdout.on("data", (chunk: Buffer) => {
    const parsed = consumeProgress(stdout, chunk.toString());
    stdout = parsed.rest;
    if (parsed.seconds != null && jobs.get(key) === job) job.seconds = parsed.seconds;
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  child.on("error", (error) => fail(error.message));
  child.on("close", (code) => {
    if (jobs.get(key) !== job || job.state !== "running") return;
    if (code === 0 && playlistHasSegment(readPlaylist(dir))) {
      fs.writeFileSync(done, "");
      jobs.delete(key);
      return;
    }
    fail(tail(stderr) || `ffmpeg exited with ${code ?? "no code"}`);
  });

  return { status: statusFor("running", 0, input.duration, false, null), dir };
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
