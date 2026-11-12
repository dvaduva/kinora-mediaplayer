import { useEffect, useRef, useState } from "react";
import { activeCueLines, parseVtt, type Cue } from "@kinora/client";
import type { SubtitleStyle } from "@kinora/shared";

const TICK_MS = 150;

/**
 * Captions drawn by Kinora over a native player's picture (AVPlay draws outside the page, so there are
 * no text tracks). Follows the subtitle settings (size, color) and the per-file delay.
 */
export function SubtitleOverlay(props: { url: string | null; delay: number; style: SubtitleStyle; currentTime: () => number }) {
  const { url, delay, style } = props;
  const [cues, setCues] = useState<Cue[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const timeRef = useRef(props.currentTime);
  timeRef.current = props.currentTime;

  useEffect(() => {
    setCues([]);
    setLines([]);
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then((response) => (response.ok ? response.text() : ""))
      .then((text) => {
        if (!cancelled) setCues(parseVtt(text));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (cues.length === 0) return;
    let shown = "";
    const tick = () => {
      const next = activeCueLines(cues, timeRef.current(), delay);
      const key = next.join("\n");
      if (key === shown) return;
      shown = key;
      setLines(next);
    };
    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [cues, delay]);

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
