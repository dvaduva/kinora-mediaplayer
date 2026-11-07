import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { SubtitleStatus } from "@kinora/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { mediaFiles, subtitleAssets } from "../db/schema.js";
import { dataDir } from "../paths.js";
import { bins, run, tools } from "../process.js";
import { decodeSubtitle, ensureVtt, romanianOrthography, srtToVtt } from "./srt.js";

type SubtitleAsset = typeof subtitleAssets.$inferSelect;

const TEXT_CODECS = new Set(["srt", "vtt", "subrip", "ass", "ssa", "mov_text", "webvtt", "text"]);
// ffmpeg prints progress about twice a second; this long without output means it is stuck.
const STALL_MS = 3 * 60_000;
const RETRY_AFTER_ERROR_MS = 60_000;

interface ExtractionJob {
  state: "extracting" | "error";
  progress: number | null;
  error: string | null;
  finishedAt: number;
  promise: Promise<void>;
}

// One job per video file: a single pass over the file extracts every embedded text track.
const jobs = new Map<string, ExtractionJob>();

function isTextBased(asset: SubtitleAsset) {
  return TEXT_CODECS.has((asset.codec ?? "").toLowerCase());
}

function cacheFile(asset: SubtitleAsset, sourcePath: string) {
  const stat = fs.statSync(sourcePath);
  return path.join(dataDir, "cache", "subtitles", `${asset.id}-${stat.size}-${Math.round(stat.mtimeMs)}.vtt`);
}

// Earlier versions left empty files behind when ffmpeg was killed. A real WebVTT file is never empty.
function isCached(destination: string) {
  try {
    if (fs.statSync(destination).size > 0) return true;
    fs.rmSync(destination, { force: true });
  } catch {
    // Missing file.
  }
  return false;
}

function finalizeVtt(asset: SubtitleAsset, text: string) {
  return asset.language === "ro" ? romanianOrthography(text) : text;
}

export function subtitleStatus(asset: SubtitleAsset, videoPath: string): SubtitleStatus {
  if (!isTextBased(asset)) return { state: "error", error: "bitmap" };
  if (asset.origin !== "embedded") return { state: "ready" };
  if (!tools.ffmpeg) return { state: "error", error: "needs_ffmpeg" };
  if (isCached(cacheFile(asset, videoPath))) return { state: "ready" };
  const job = startExtraction(asset.fileId, videoPath);
  if (job.state === "error") return { state: "error", error: job.error ?? "extract_failed" };
  return { state: "extracting", progress: job.progress };
}

/** Starts extracting the embedded text subtitles of a file in the background, if not done already. */
export function prepareEmbeddedSubtitles(fileId: string, videoPath: string) {
  if (!tools.ffmpeg) return;
  startExtraction(fileId, videoPath);
}

function startExtraction(fileId: string, videoPath: string) {
  const existing = jobs.get(fileId);
  if (existing && (existing.state === "extracting" || Date.now() - existing.finishedAt < RETRY_AFTER_ERROR_MS)) return existing;
  const job: ExtractionJob = { state: "extracting", progress: null, error: null, finishedAt: 0, promise: Promise.resolve() };
  job.promise = extractEmbedded(fileId, videoPath, job).then(
    () => {
      jobs.delete(fileId);
    },
    (error: unknown) => {
      job.state = "error";
      job.error = error instanceof Error ? error.message : "extract_failed";
      job.finishedAt = Date.now();
    },
  );
  jobs.set(fileId, job);
  return job;
}

async function extractEmbedded(fileId: string, videoPath: string, job: ExtractionJob) {
  const pending = db
    .select()
    .from(subtitleAssets)
    .where(and(eq(subtitleAssets.fileId, fileId), eq(subtitleAssets.origin, "embedded")))
    .all()
    .filter((asset) => isTextBased(asset) && asset.streamIndex != null)
    .map((asset) => {
      const destination = cacheFile(asset, videoPath);
      return { asset, destination, temp: `${destination}.${process.pid}.part` };
    })
    .filter((entry) => !isCached(entry.destination));
  if (pending.length === 0) return;
  fs.mkdirSync(path.dirname(pending[0].destination), { recursive: true });
  const duration = db.select({ duration: mediaFiles.duration }).from(mediaFiles).where(eq(mediaFiles.id, fileId)).get()?.duration ?? null;

  const args = ["-nostdin", "-v", "error", "-y", "-progress", "pipe:1", "-nostats", "-i", videoPath];
  for (const entry of pending) args.push("-map", `0:${entry.asset.streamIndex}`, "-c:s", "webvtt", "-f", "webvtt", entry.temp);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bins.ffmpeg, args, { windowsHide: true });
      let stderr = "";
      let buffered = "";
      let stall = setTimeout(() => child.kill(), STALL_MS);
      child.stdout.on("data", (chunk: Buffer) => {
        clearTimeout(stall);
        stall = setTimeout(() => child.kill(), STALL_MS);
        buffered += chunk.toString();
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const match = /^out_time_(?:us|ms)=(\d+)/.exec(line);
          if (match && duration && duration > 0) job.progress = Math.min(1, Number(match[1]) / 1_000_000 / duration);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.on("error", (error) => {
        clearTimeout(stall);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(stall);
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() ? "extract_failed" : "extract_timeout"));
      });
    });
    for (const entry of pending) {
      if (!fs.existsSync(entry.temp)) continue;
      const text = fs.readFileSync(entry.temp, "utf8");
      fs.writeFileSync(entry.temp, finalizeVtt(entry.asset, text), "utf8");
      fs.renameSync(entry.temp, entry.destination);
    }
  } finally {
    for (const entry of pending) fs.rmSync(entry.temp, { force: true });
  }
}

export async function materializeSubtitle(asset: SubtitleAsset, videoPath: string) {
  const codec = (asset.codec ?? "").toLowerCase();
  if (!isTextBased(asset)) throw new Error("bitmap");

  if (asset.origin === "embedded") {
    if (!tools.ffmpeg) throw new Error("needs_ffmpeg");
    const destination = cacheFile(asset, videoPath);
    if (isCached(destination)) return destination;
    await startExtraction(asset.fileId, videoPath).promise;
    if (isCached(destination)) return destination;
    throw new Error(jobs.get(asset.fileId)?.error ?? "extract_failed");
  }

  const sourcePath = asset.path ?? videoPath;
  const destination = cacheFile(asset, sourcePath);
  if (isCached(destination)) return destination;
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (codec === "srt" || codec === "subrip" || codec === "vtt" || codec === "webvtt") {
    const decoded = decodeSubtitle(fs.readFileSync(sourcePath));
    const vtt = codec === "vtt" || codec === "webvtt" ? ensureVtt(decoded) : srtToVtt(decoded);
    fs.writeFileSync(destination, finalizeVtt(asset, vtt), "utf8");
    return destination;
  }

  if (!tools.ffmpeg) throw new Error("needs_ffmpeg");
  const temp = `${destination}.${process.pid}.part`;
  try {
    const result = await run(bins.ffmpeg, ["-nostdin", "-y", "-i", sourcePath, "-f", "webvtt", temp], 60_000);
    if (result.code !== 0 || !fs.existsSync(temp)) throw new Error("extract_failed");
    fs.renameSync(temp, destination);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return destination;
}

export function findSubtitle(fileId: string, subtitleId: string) {
  const asset = db.select().from(subtitleAssets).where(eq(subtitleAssets.id, subtitleId)).get();
  if (!asset || asset.fileId !== fileId) return null;
  return asset;
}
