import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { playbackView, resolveMediaPath } from "../catalog.js";
import { db } from "../db/index.js";
import { mediaFiles } from "../db/schema.js";
import { detectTools, tools } from "../process.js";
import { embeddedTextStreams } from "./materialize.js";
import { canCopyAudio, canCopyVideo } from "./plan.js";
import { ensureTranscode, lookupTranscode, playlistCursor, transcodeLocation } from "./transcode.js";

export function refreshTools() {
  if (!tools.ffmpeg || !tools.ffprobe) detectTools();
}

export function describePlayback(fileId: string) {
  refreshTools();
  const row = db.select().from(mediaFiles).where(eq(mediaFiles.id, fileId)).get();
  if (!row) return null;
  const filePath = resolveMediaPath(row);
  if (!filePath) return null;
  const view = playbackView(fileId);
  if (!view) return null;
  return { row, filePath, view };
}

/**
 * Starts or joins the conversion of a file. `start` opens a separate session from that media time
 * (Live TV joining a program midway); such sessions skip embedded subtitles.
 */
export async function beginTranscode(fileId: string, restartError: boolean, start = 0, known?: ReturnType<typeof describePlayback>, background = false) {
  // Resolving a file on a network share can take seconds; callers that already did it pass the result.
  const described = known ?? describePlayback(fileId);
  if (!described || !described.view.plan.available || described.view.plan.mode === "direct") return null;
  const stat = fs.statSync(described.filePath);
  return ensureTranscode(
    {
      fileId,
      sourcePath: described.filePath,
      size: stat.size,
      mtime: Math.round(stat.mtimeMs),
      duration: described.row.duration,
      copyVideo: canCopyVideo(described.view.plan.videoCodec),
      copyAudio: canCopyAudio(described.view.plan.audioCodec),
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
