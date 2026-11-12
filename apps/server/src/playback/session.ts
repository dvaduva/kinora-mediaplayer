import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { playbackView, resolveMediaPath } from "../catalog.js";
import { db } from "../db/index.js";
import { mediaFiles } from "../db/schema.js";
import { detectTools, tools } from "../process.js";
import { embeddedTextStreams } from "./materialize.js";
import { BROWSER_PROFILE, type CapabilityProfile, type EffectiveProfile } from "@kinora/shared";
import { planInputFor } from "../catalog.js";
import { canCopyAudio, canCopyVideo, hlsOutput, type HlsOutput } from "./plan.js";
import { ensureTranscode, lookupTranscode, playlistCursor, transcodeLocation } from "./transcode.js";

export function refreshTools() {
  if (!tools.ffmpeg || !tools.ffprobe) detectTools();
}

type Profile = CapabilityProfile | EffectiveProfile;

/**
 * The cache and session name of an HLS output: empty when it is what the browser gets for this file,
 * so conversions made before profiles existed are still found.
 */
export function outputVariant(output: HlsOutput, browser: { copyVideo: boolean; copyAudio: boolean }) {
  const browserLike =
    output.copyVideo === browser.copyVideo &&
    output.copyAudio === browser.copyAudio &&
    (output.copyAudio || output.audio.codec === "aac") &&
    output.maxHeight == null &&
    output.maxBitrate == null;
  if (browserLike) return "";
  return [
    output.copyVideo ? "vc" : "ve",
    output.copyAudio ? "ac" : `a${output.audio.codec}${output.audio.channels}`,
    output.maxHeight ? `h${output.maxHeight}` : "",
    output.maxBitrate ? `b${Math.round(output.maxBitrate / 1000)}k` : "",
  ]
    .filter(Boolean)
    .join("-");
}

/** The output variant of a file for a profile, without resolving its path (cheap enough for every segment request). */
export function variantFor(fileId: string, profile: Profile) {
  if (profile === BROWSER_PROFILE) return "";
  const row = db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get();
  if (!row) return "";
  const input = planInputFor(row);
  return outputVariant(hlsOutput(input, profile), { copyVideo: canCopyVideo(row.videoCodec), copyAudio: canCopyAudio(input.audioCodec) });
}

/** A file's playback view and HLS output for one client profile (the browser's by default). */
export function describePlayback(fileId: string, profile: Profile = BROWSER_PROFILE) {
  refreshTools();
  const row = db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get();
  if (!row) return null;
  const filePath = resolveMediaPath(row);
  if (!filePath) return null;
  const view = playbackView(fileId, profile);
  if (!view) return null;
  const input = planInputFor(row);
  const output = hlsOutput(input, profile);
  const variant = outputVariant(output, { copyVideo: canCopyVideo(row.videoCodec), copyAudio: canCopyAudio(input.audioCodec) });
  return { row, filePath, view, output, variant };
}

/**
 * Starts or joins the conversion of a file. `start` opens a separate session from that media time
 * (Live TV joining a program midway); such sessions skip embedded subtitles.
 */
export async function beginTranscode(
  fileId: string,
  restartError: boolean,
  start = 0,
  known?: ReturnType<typeof describePlayback>,
  background = false,
  profile: Profile = BROWSER_PROFILE,
) {
  // Resolving a file on a network share can take seconds; callers that already did it pass the result.
  const described = known ?? describePlayback(fileId, profile);
  if (!described || !described.view.plan.available || described.view.plan.mode === "direct") return null;
  const stat = fs.statSync(described.filePath);
  return ensureTranscode(
    {
      fileId,
      sourcePath: described.filePath,
      size: stat.size,
      mtime: Math.round(stat.mtimeMs),
      duration: described.row.duration,
      copyVideo: described.output.copyVideo,
      copyAudio: described.output.copyAudio,
      variant: described.variant,
      output: described.variant
        ? { audio: described.output.audio, maxHeight: described.output.maxHeight, maxBitrate: described.output.maxBitrate }
        : undefined,
      subtitleStreams: start > 0 ? [] : embeddedTextStreams(fileId),
      start,
      background,
    },
    restartError,
  );
}

/**
 * Media seconds the whole-file conversion already covers: Infinity once it is complete, the encoder's
 * position while it runs, or what a stopped partial conversion left on disk.
 */
export function wholeTranscodeReach(fileId: string, filePath: string) {
  const open = lookupTranscode(fileId, false);
  if (open?.status.state === "ready") return Number.POSITIVE_INFINITY;
  if (open?.status.state === "running") return open.status.seconds;
  try {
    const stat = fs.statSync(filePath);
    const { dir } = transcodeLocation({ fileId, size: stat.size, mtime: Math.round(stat.mtimeMs) });
    if (fs.existsSync(path.join(dir, "done"))) return Number.POSITIVE_INFINITY;
    return playlistCursor(fs.readFileSync(path.join(dir, "index.m3u8"), "utf8")).seconds;
  } catch {
    return 0;
  }
}
