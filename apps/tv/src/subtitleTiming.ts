// Cue times as the file has them, so a new delay is applied from the source and never stacks.
const original = new WeakMap<TextTrackCue, { start: number; end: number }>();
const delays = new WeakMap<HTMLMediaElement, number>();

/** Moves every cue of the track to its source time plus the delay. */
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
