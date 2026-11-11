import type { SubtitleStyle } from "@kinora/shared";

// Cue times as the file has them, so a new delay is applied from the source and never stacks.
const original = new WeakMap<TextTrackCue, { start: number; end: number }>();
const delays = new WeakMap<HTMLMediaElement, number>();

/** Seconds the captions on this element are shifted; positive shows them later. */
export function subtitleDelay(media: HTMLMediaElement) {
  return delays.get(media) ?? 0;
}

/** Moves every cue of the track to its source time plus the delay. Cues added later need another call. */
export function shiftCues(track: TextTrack, delay: number) {
  const cues = track.cues;
  if (!cues) return;
  for (const cue of Array.from(cues)) {
    let base = original.get(cue);
    if (!base) {
      base = { start: cue.startTime, end: cue.endTime };
      original.set(cue, base);
    }
    const start = Math.max(0, base.start + delay);
    const end = Math.max(start, base.end + delay);
    if (cue.startTime !== start) cue.startTime = start;
    if (cue.endTime !== end) cue.endTime = end;
  }
}

export function setSubtitleDelay(media: HTMLMediaElement, delay: number) {
  delays.set(media, delay);
  for (const track of Array.from(media.textTracks)) shiftCues(track, delay);
}

/** Formats a delay for display: +0.5 s, −1.2 s, 0 s. */
export function formatDelay(delay: number, locale: string) {
  const rounded = Math.round(delay * 10) / 10;
  if (rounded === 0) return "0 s";
  const value = Math.abs(rounded).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${rounded > 0 ? "+" : "−"}${value} s`;
}

/** Caption styling for videos marked with the given class. ::cue does not reliably take custom properties, so values go in as text. */
export function cueStyleSheet(selector: string, style: SubtitleStyle) {
  const color = /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : "#ffffff";
  const size = Number.isFinite(style.size) ? Math.round(style.size) : 100;
  return `${selector}::cue { color: ${color}; font-size: ${size}%; }`;
}
