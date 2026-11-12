/**
 * A small WebVTT reader for the subtitle overlay: players that draw the picture outside the page
 * (AVPlay on Tizen, ExoPlayer on Android TV) have no text tracks, so Kinora draws the captions itself.
 * The server always serves subtitles as WebVTT (`/api/subtitles/:fileId/:id`).
 */
export interface Cue {
  start: number;
  end: number;
  /** Plain text, one entry per line; markup removed. */
  lines: string[];
}

const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

export function parseTimestamp(value: string): number | null {
  const parts = value.trim().replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    const number = Number(part);
    if (!Number.isFinite(number) || number < 0) return null;
    total = total * 60 + number;
  }
  return total;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", nbsp: " ", quot: '"', apos: "'", lrm: "", rlm: "" };

function cleanLine(line: string) {
  return line
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = Number(name.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      const value = ENTITIES[name.toLowerCase()];
      return value === undefined ? whole : value;
    })
    .trim();
}

/** Cues sorted by start time. Blocks without a timing line (header, NOTE, STYLE, REGION) are skipped. */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const rows = block.split("\n");
    const at = rows.findIndex((row) => TIMING.test(row));
    if (at < 0) continue;
    const timing = TIMING.exec(rows[at]!)!;
    const start = parseTimestamp(timing[1]!);
    const end = parseTimestamp(timing[2]!);
    if (start == null || end == null || end <= start) continue;
    const lines = rows.slice(at + 1).map(cleanLine).filter((line) => line.length > 0);
    if (lines.length) cues.push({ start, end, lines });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Lines of the cues showing at `time`, with captions shifted by `delay` seconds (positive shows them
 * later, as in the subtitle delay setting). Cues may overlap; their lines are stacked in order.
 */
export function activeCueLines(cues: Cue[], time: number, delay = 0): string[] {
  const at = time - delay;
  const out: string[] = [];
  for (const cue of cues) {
    if (cue.start > at) break;
    if (at < cue.end) out.push(...cue.lines);
  }
  return out;
}
