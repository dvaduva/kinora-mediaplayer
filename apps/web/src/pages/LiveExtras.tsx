import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { ChannelProgram, LiveChannel, LiveGuide } from "@kinora/shared";
import { api } from "../api";
import type { Copy, Locale } from "../i18n";
import { CategoryBar, ChannelLogo, clockTime, currentAndNext, effectiveFilter, filterChannels, programProgress, programTitle, serverNow, syncClock, useChannelFilter, useNow } from "../liveTv";
import { Icon } from "../ui";
import { bands, bass, fitCanvas, useFrames } from "../visualizer";

const BRASS = "210,174,98";

/**
 * Routes a media element through an analyser so music channels get a moving visual. The element is
 * connected only once the audio context runs: a suspended context would silence it. Until then (no
 * user gesture yet) the visual waits for the first click or key press.
 */
export function useMediaAnalyser(media: RefObject<HTMLMediaElement | null>, wanted: boolean) {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const graph = useRef<{ context: AudioContext; node: AnalyserNode } | null>(null);
  useEffect(() => {
    if (!wanted || graph.current) {
      if (graph.current) setAnalyser(graph.current.node);
      return;
    }
    let cancelled = false;
    const attach = async () => {
      const element = media.current;
      if (!element || graph.current || cancelled) return;
      try {
        const context = new window.AudioContext();
        await context.resume().catch(() => undefined);
        if (context.state !== "running" || cancelled) {
          void context.close().catch(() => undefined);
          return;
        }
        const source = context.createMediaElementSource(element);
        const node = context.createAnalyser();
        node.fftSize = 1024;
        node.smoothingTimeConstant = 0.78;
        source.connect(node);
        node.connect(context.destination);
        graph.current = { context, node };
        setAnalyser(node);
        window.removeEventListener("pointerdown", onGesture);
        window.removeEventListener("keydown", onGesture);
      } catch {
        // No Web Audio: the cover shows without the spectrum.
      }
    };
    const onGesture = () => void attach();
    void attach();
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [media, wanted]);
  useEffect(
    () => () => {
      void graph.current?.context.close().catch(() => undefined);
      graph.current = null;
    },
    [],
  );
  return wanted ? analyser : null;
}

/** Album cover over a blurred copy of itself, with a radial spectrum around it. */
export function LiveMusicVisual(props: { analyser: AnalyserNode | null; cover: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levels = useRef(new Float32Array(64));
  const smooth = useRef(0);
  const calm = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useFrames(props.analyser, (data) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { width, height, ratio } = fitCanvas(canvas);
    const count = levels.current.length;
    bands(data, count, levels.current);
    smooth.current += (bass(data) - smooth.current) * 0.25;
    const pulse = calm.current ? 0 : smooth.current;
    // The cover is 30% of the stage width, centered.
    const radius = (width * 0.3) / 2 + 8 * ratio;
    const reach = Math.min(width, height) * 0.14;
    const cx = width / 2;
    const cy = height / 2;
    context.clearRect(0, 0, width, height);
    const glow = context.createRadialGradient(cx, cy, radius * 0.6, cx, cy, radius + reach * 1.6);
    glow.addColorStop(0, `rgba(${BRASS},${0.06 + pulse * 0.3})`);
    glow.addColorStop(1, "rgba(12,11,16,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    context.lineCap = "round";
    context.lineWidth = Math.max(2, ((Math.PI * 2 * radius) / (count * 2)) * 0.5);
    for (let index = 0; index < count * 2; index += 1) {
      const level = levels.current[index < count ? index : count * 2 - 1 - index] ?? 0;
      const angle = (index / (count * 2)) * Math.PI * 2 - Math.PI / 2;
      const length = 3 * ratio + level * level * reach;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      context.strokeStyle = `rgba(${BRASS},${0.35 + level * 0.65})`;
      context.beginPath();
      context.moveTo(cx + cos * radius, cy + sin * radius);
      context.lineTo(cx + cos * (radius + length), cy + sin * (radius + length));
      context.stroke();
    }
  });
  return (
    <div className="live-music" aria-hidden="true">
      {props.cover ? <div className="live-music-backdrop" style={{ backgroundImage: `url("${props.cover}")` }} /> : null}
      <canvas ref={canvasRef} />
      <div className="live-music-cover">{props.cover ? <img src={props.cover} alt="" /> : <div className="face" />}</div>
    </div>
  );
}

const HOUR = 60 * 60 * 1000;

/** Channel list over the picture: what airs now on each channel, filtered by category; a click tunes in. */
export function MiniGuide(props: { currentId: string | undefined; t: Copy; locale: Locale; onPick: (channel: LiveChannel) => void; onClose: () => void }) {
  const { t, locale } = props;
  const now = useNow(15_000);
  const [guide, setGuide] = useState<LiveGuide | null>(null);
  const [failed, setFailed] = useState(false);
  const [filterChoice, setFilter] = useChannelFilter();
  const list = useRef<HTMLUListElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  useEffect(() => {
    const load = () => {
      const sentAt = Date.now();
      const from = serverNow();
      api<LiveGuide>(`/api/livetv/guide?from=${Math.floor(from)}&to=${Math.floor(from + 3 * HOUR)}`)
        .then((data) => {
          syncClock(data.now, sentAt);
          setGuide(data);
        })
        .catch(() => setFailed(true));
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "g") {
        event.preventDefault();
        event.stopPropagation();
        onClose.current();
      }
    };
    // Capture: the player's own keys (zapping on arrows) wait while the list is open.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const channels = guide?.channels ?? [];
  const filter = effectiveFilter(filterChoice, channels);
  const shown = filterChannels(channels, filter);
  const programs = useMemo(() => {
    const map = new Map<string, ChannelProgram[]>();
    for (const program of guide?.programs ?? []) {
      const entry = map.get(program.channelId);
      if (entry) entry.push(program);
      else map.set(program.channelId, [program]);
    }
    return map;
  }, [guide]);

  // Start on the channel being watched.
  useEffect(() => {
    if (!guide) return;
    const button = list.current?.querySelector<HTMLButtonElement>(".mini-guide-item.current") ?? list.current?.querySelector<HTMLButtonElement>(".mini-guide-item");
    button?.focus();
    button?.scrollIntoView({ block: "nearest" });
  }, [guide]);

  /** Up and down move between rows, as on a remote. */
  const onListKey = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>(".mini-guide-item") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    next?.focus();
  };

  return (
    <aside className="mini-guide" aria-label={t.liveMiniGuide} onPointerDown={(event) => event.stopPropagation()}>
      <div className="mini-guide-head">
        <h2>{t.liveMiniGuide}</h2>
        <button className="dialog-close" type="button" onClick={props.onClose} aria-label={t.liveMiniGuideClose} title={t.liveMiniGuideClose}>
          <Icon name="close" />
        </button>
      </div>
      {channels.length > 0 ? <CategoryBar channels={channels} filter={filter} onChange={setFilter} t={t} /> : <span />}
      {failed && !guide ? <p className="danger">{t.liveGuideFailed}</p> : null}
      {guide && shown.length === 0 ? <p className="muted">{filter.kind === "favorites" ? t.liveNoFavorites : t.liveNothingHere}</p> : null}
      <ul ref={list} onKeyDown={onListKey}>
        {shown.map((channel) => {
          const entries = programs.get(channel.id) ?? [];
          const { current, next } = currentAndNext(entries, now);
          return (
            <li key={channel.id}>
              <button type="button" className={`mini-guide-item${channel.id === props.currentId ? " current" : ""}`} onClick={() => props.onPick(channel)}>
                <ChannelLogo channel={channel} />
                <span className="mini-guide-text">
                  <span>
                    <span className="guide-channel-number">{channel.number}</span> {channel.name}
                  </span>
                  {current ? (
                    <>
                      <small>{programTitle(current, t)}</small>
                      <span className="meter small"><span style={{ width: `${programProgress(current, now) * 100}%` }} /></span>
                    </>
                  ) : null}
                  {next ? (
                    <small className="muted">
                      {t.liveNext} {clockTime(next.start, locale)} · {next.title}
                    </small>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
