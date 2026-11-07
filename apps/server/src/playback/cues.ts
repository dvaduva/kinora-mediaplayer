import type { SubtitleCue } from "@kinora/shared";

/** Subtitles are served to the player in windows of this many seconds of media time. */
export const CHUNK_SECONDS = 60;

function parseTimestamp(value: string) {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, "0")) / 1000;
}

/**
 * Parses WebVTT cues. A file that ffmpeg is still writing can end mid-cue,
 * so with `growing` the last block counts only once a blank line closes it.
 */
export function parseVtt(text: string, growing = false): SubtitleCue[] {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  if (growing && !/\n\n$/.test(normalized)) blocks.pop();
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0) continue;
    const [from, rest] = lines[timing].split("-->");
    const start = parseTimestamp(from);
    const end = parseTimestamp((rest ?? "").trim().split(/\s+/)[0] ?? "");
    const body = lines.slice(timing + 1).join("\n").trim();
    if (start == null || end == null || !body) continue;
    cues.push({ start, end, text: body });
  }
  return cues;
}

/** Cues that start inside chunk `index`, after shifting them by `offset` seconds onto the media timeline. */
export function cuesInChunk(cues: SubtitleCue[], index: number, offset = 0) {
  const from = index * CHUNK_SECONDS;
  const to = from + CHUNK_SECONDS;
  const out: SubtitleCue[] = [];
  for (const cue of cues) {
    const start = cue.start + offset;
    if (start >= from && start < to) out.push({ start, end: cue.end + offset, text: cue.text });
  }
  return out;
}
