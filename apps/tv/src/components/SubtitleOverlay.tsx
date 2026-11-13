import { useEffect, useRef, useState } from "react";
import { activeCueLines, api, parseVtt, type Cue } from "@kinora/client";
import type { SubtitleChunk, SubtitleStyle } from "@kinora/shared";

const TICK_MS = 150;
/** Must match CHUNK_SECONDS on the server. */
const CHUNK_SECONDS = 60;
/** A window the server has not finished reading is asked for again after this long. */
const PARTIAL_RETRY_MS = 4000;
const ERROR_RETRY_MS = 10_000;

/** A subtitle file (external, as WebVTT), or an embedded text track the server reads out of the video a minute at a time. */
export type SubtitleSource = { kind: "file"; url: string } | { kind: "embedded"; fileId: string; subtitleId: string };

function sourceKey(source: SubtitleSource | null) {
  if (!source) return "";
  return source.kind === "file" ? `file:${source.url}` : `embedded:${source.fileId}:${source.subtitleId}`;
}

/** WebVTT cue text to plain lines: tags (<i>, <c.x>, <00:01.000>) dropped, entities the server writes decoded. */
function cueLines(text: string) {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

/**
 * Captions drawn by Kinora over the picture: always for a native player (AVPlay draws outside the page,
 * so there are no text tracks), and for embedded subtitles on any player. Follows the subtitle
 * settings (size, color) and the per-file delay.
 */
export function SubtitleOverlay(props: { source: SubtitleSource | null; delay: number; style: SubtitleStyle; currentTime: () => number }) {
  const { delay, style } = props;
  const key = sourceKey(props.source);
  const sourceRef = useRef(props.source);
  sourceRef.current = props.source;
  const [cues, setCues] = useState<Cue[]>([]);
  /** Bumped when embedded windows add cues, so the tick below sees the longer list. */
  const [revision, setRevision] = useState(0);
  const cuesRef = useRef<Cue[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const timeRef = useRef(props.currentTime);
  timeRef.current = props.currentTime;
  const delayRef = useRef(delay);
  delayRef.current = delay;

  useEffect(() => {
    cuesRef.current = [];
    setCues([]);
    setLines([]);
    const source = sourceRef.current;
    if (!source) return;
    let cancelled = false;

    if (source.kind === "file") {
      fetch(source.url)
        .then((response) => (response.ok ? response.text() : ""))
        .then((text) => {
          if (cancelled) return;
          cuesRef.current = parseVtt(text);
          setCues(cuesRef.current);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }

    const { fileId, subtitleId } = source;
    const seen = new Set<string>();
    const done = new Set<number>();
    const retryAt = new Map<number, number>();
    const inflight = new Map<number, AbortController>();

    const load = (index: number) => {
      if (index < 0 || done.has(index) || inflight.has(index)) return;
      if ((retryAt.get(index) ?? 0) > Date.now()) return;
      const controller = new AbortController();
      inflight.set(index, controller);
      api<SubtitleChunk>(`/api/subtitles/${fileId}/${subtitleId}/chunk/${index}`, { signal: controller.signal })
        .then((chunk) => {
          if (cancelled) return;
          let added = false;
          for (const cue of chunk.cues) {
            const id = `${cue.start}|${cue.text}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const cueText = cueLines(cue.text);
            if (cueText.length === 0) continue;
            cuesRef.current.push({ start: cue.start, end: cue.end, lines: cueText });
            added = true;
          }
          if (added) {
            cuesRef.current.sort((a, b) => a.start - b.start);
            setRevision((value) => value + 1);
          }
          if (chunk.complete) done.add(index);
          else retryAt.set(index, Date.now() + PARTIAL_RETRY_MS);
        })
        .catch(() => {
          if (!controller.signal.aborted) retryAt.set(index, Date.now() + ERROR_RETRY_MS);
        })
        .finally(() => inflight.delete(index));
    };

    const want = () => {
      // With a delay the cues on screen come from earlier or later in the file.
      const index = Math.max(0, Math.floor((timeRef.current() - delayRef.current) / CHUNK_SECONDS));
      // Windows away from the playhead are no longer needed; the server stops reading them.
      for (const [other, controller] of inflight) {
        if (other !== index && other !== index + 1) controller.abort();
      }
      load(index);
      // The next window is read only once the current one is in, so it never delays it.
      if (done.has(index)) load(index + 1);
    };
    want();
    const timer = window.setInterval(want, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      for (const controller of inflight.values()) controller.abort();
    };
  }, [key]);

  useEffect(() => {
    const list = cuesRef.current;
    if (list.length === 0) return;
    let shown = "";
    const tick = () => {
      const next = activeCueLines(list, timeRef.current(), delay);
      const joined = next.join("\n");
      if (joined === shown) return;
      shown = joined;
      setLines(next);
    };
    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [cues, revision, delay]);

  if (lines.length === 0) return null;
  const color = /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : "#ffffff";
  const size = Number.isFinite(style.size) ? style.size : 100;
  return (
    <div className="subtitle-overlay" aria-live="off">
      <p style={{ color, fontSize: `${(4.6 * size) / 100}vh` }}>
        {lines.map((line, index) => (
          <span key={index}>
            {line}
            {index < lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    </div>
  );
}
