import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ClipLoop } from "./clipLoop";

const BRASS = [210, 174, 98] as const;
/** Brightness levels the spectrum bars are drawn in, one stroke each. */
const ALPHA_BUCKETS = 6;

/** Splits the analyser's linear bins into log-spaced bands, 0..1 each. */
export function bands(data: Uint8Array, count: number, out: Float32Array) {
  const first = 2;
  const last = Math.min(data.length - 1, 320);
  for (let band = 0; band < count; band += 1) {
    const from = Math.floor(first * Math.pow(last / first, band / count));
    const to = Math.max(from + 1, Math.floor(first * Math.pow(last / first, (band + 1) / count)));
    let peak = 0;
    for (let bin = from; bin < to; bin += 1) peak = Math.max(peak, data[bin] ?? 0);
    out[band] = peak / 255;
  }
}

export function bass(data: Uint8Array) {
  let sum = 0;
  for (let bin = 1; bin < 8; bin += 1) sum += data[bin] ?? 0;
  return sum / (7 * 255);
}

/** Frames of all-zero spectrum, while the music plays, after which the analyser is taken to be deaf. */
const DEAF_FRAMES = 90;

/**
 * Stand-in spectrum: slow waves over the bands and a kick on the low end at 120 bpm. Used where
 * <audio> plays through a hardware pipeline that Web Audio cannot tap (Samsung Tizen, some webOS),
 * so the analyser reads silence although the music plays.
 */
export function syntheticSpectrum(data: Uint8Array, time: number) {
  const seconds = time / 1000;
  const kick = Math.pow(Math.max(0, Math.sin(seconds * Math.PI * 2)), 8);
  for (let bin = 0; bin < data.length; bin += 1) {
    const falloff = Math.max(0, 1 - bin / 360);
    const wave = 0.5 + 0.25 * Math.sin(seconds * 1.7 + bin * 0.11) + 0.2 * Math.sin(seconds * 0.63 - bin * 0.047);
    const low = bin < 10 ? kick * 0.45 : 0;
    data[bin] = Math.round(255 * Math.min(1, falloff * wave * 0.85 + low));
  }
}

/**
 * Calls `draw` every frame with the analyser's spectrum. With `playing` given, an analyser that stays
 * silent while the music plays is replaced by `syntheticSpectrum`, so the visuals still move.
 */
export function useFrames(analyser: AnalyserNode | null, draw: (data: Uint8Array) => void, playing?: boolean, maxFps = 60) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    let silent = 0;
    let last = 0;
    // A frame budget under the display's: on a TV the same CPU also has to answer the remote.
    const interval = 1000 / maxFps - 2;
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (time - last < interval) return;
      last = time;
      analyser.getByteFrequencyData(data);
      let heard = false;
      for (let bin = 0; bin < data.length && !heard; bin += 4) heard = data[bin] !== 0;
      if (heard) silent = 0;
      else if (playingRef.current === true) silent += 1;
      if (!heard && silent >= DEAF_FRAMES && playingRef.current === true) syntheticSpectrum(data, time);
      drawRef.current(data);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [analyser, maxFps]);
}

/**
 * Sizes the canvas backing store to its box. A `scale` under 1 draws fewer pixels, stretched by the
 * compositor: the full-screen visual at half resolution is a quarter of the work.
 */
export function fitCanvas(canvas: HTMLCanvasElement, scale = 1) {
  const ratio = (window.devicePixelRatio || 1) * scale;
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
}

/** Thin mirrored spectrum along the bottom edge, drawn over a music video. */
function drawStrip(context: CanvasRenderingContext2D, width: number, height: number, ratio: number, levels: Float32Array) {
  context.clearRect(0, 0, width, height);
  const count = levels.length;
  const total = count * 2;
  const step = width / total;
  const reach = Math.min(90 * ratio, height * 0.12);
  for (let index = 0; index < total; index += 1) {
    const level = levels[index < count ? count - 1 - index : index - count] ?? 0;
    const bar = 2 * ratio + level * level * reach;
    context.fillStyle = `rgba(${BRASS.join(",")},${0.45 + level * 0.55})`;
    context.fillRect(index * step + step * 0.2, height - bar, step * 0.6, bar);
  }
}

/** Small spectrum strip for the now-playing bar. */
export function MiniSpectrum(props: { analyser: AnalyserNode | null; onClick: () => void; label: string; playing?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levels = useRef(new Float32Array(24));
  useFrames(props.analyser, (data) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { width, height } = fitCanvas(canvas);
    bands(data, levels.current.length, levels.current);
    context.clearRect(0, 0, width, height);
    const step = width / levels.current.length;
    context.fillStyle = `rgb(${BRASS.join(",")})`;
    levels.current.forEach((level, index) => {
      const bar = Math.max(2, level * height);
      context.fillRect(index * step + step * 0.2, height - bar, step * 0.6, bar);
    });
  }, props.playing, 30);
  return (
    <button className="mini-spectrum" type="button" onClick={props.onClick} aria-label={props.label} title={props.label}>
      <canvas ref={canvasRef} />
    </button>
  );
}

/**
 * Full-screen visual. With a music video: a muted looping excerpt fills the
 * screen and the spectrum runs along the bottom. Without one: cover art
 * breathing on the bass with a radial spectrum around it.
 *
 * `actions` / `controls` let each app inject its own chrome (web buttons, TV Focusable).
 */
export function Visualizer(props: {
  analyser: AnalyserNode | null;
  cover: string | null;
  title: string;
  artist: string;
  clipKey: string | null;
  playing: boolean;
  closeLabel: string;
  onClose: () => void;
  actions?: ReactNode;
  controls?: ReactNode;
  /**
   * For a TV: a half-resolution canvas at 30 fps and a cheap backdrop blur, so the remote stays
   * responsive and the animation even.
   */
  lite?: boolean;
  /** The music video could not play: a YouTube error code, or "api" when YouTube's player did not load. */
  onClipError?: (code: string) => void;
  /** Shown under the caption, e.g. why the music video is missing. */
  notice?: ReactNode;
}) {
  const lite = props.lite === true;
  const fps = lite ? 30 : 60;
  /** Per-frame motion was tuned at 60 fps; fewer frames move further each. */
  const frameStep = 60 / fps;
  const glowRef = useRef<{ key: string; gradient: CanvasGradient } | null>(null);
  const coverSize = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const levels = useRef(new Float32Array(96));
  const smoothBass = useRef(0);
  const rotation = useRef(0);
  const calm = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [shownFor, setShownFor] = useState<string | null>(null);
  const clipShown = props.clipKey != null && shownFor === props.clipKey;
  const clipKey = props.clipKey;
  const setClipShown = useCallback((visible: boolean) => setShownFor(visible ? clipKey : null), [clipKey]);
  const stripRef = useRef(false);
  stripRef.current = clipShown;
  const { onClose } = props;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useFrames(props.analyser, (data) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { width, height, ratio } = fitCanvas(canvas, lite ? 0.5 : 1);
    const count = levels.current.length;
    bands(data, count, levels.current);
    const low = bass(data);
    smoothBass.current += (low - smoothBass.current) * Math.min(1, 0.25 * frameStep);
    const pulse = calm.current ? 0 : smoothBass.current;
    if (!calm.current) rotation.current += (0.0015 + pulse * 0.01) * frameStep;

    if (stripRef.current) {
      drawStrip(context, width, height, ratio, levels.current);
      return;
    }

    const cx = width / 2;
    const cy = height / 2;
    const base = Math.min(width, height) * 0.2;
    const growth = 1 + pulse * 0.08;
    const radius = base * growth;
    const reach = Math.min(width, height) * 0.16;

    context.clearRect(0, 0, width, height);
    // One gradient per canvas size; the bass only changes how strongly it is laid on.
    const glowKey = `${width}x${height}`;
    if (glowRef.current?.key !== glowKey) {
      const gradient = context.createRadialGradient(cx, cy, base * 0.5, cx, cy, base + reach * 1.6);
      gradient.addColorStop(0, `rgb(${BRASS.join(",")})`);
      gradient.addColorStop(1, `rgba(${BRASS.join(",")},0)`);
      glowRef.current = { key: glowKey, gradient };
    }
    context.globalAlpha = Math.min(1, 0.08 + smoothBass.current * 0.35);
    context.fillStyle = glowRef.current.gradient;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 1;

    // Bars grouped by brightness: a handful of strokes per frame instead of one per bar.
    context.lineCap = "round";
    context.lineWidth = Math.max(2 * (lite ? 0.5 : 1), ((Math.PI * 2 * radius) / (count * 2)) * 0.55);
    context.strokeStyle = `rgb(${BRASS.join(",")})`;
    const inner = radius + 6 * ratio;
    for (let bucket = 0; bucket < ALPHA_BUCKETS; bucket += 1) {
      let any = false;
      context.beginPath();
      for (let index = 0; index < count * 2; index += 1) {
        const level = levels.current[index < count ? index : count * 2 - 1 - index] ?? 0;
        if (Math.min(ALPHA_BUCKETS - 1, Math.floor(level * ALPHA_BUCKETS)) !== bucket) continue;
        const angle = rotation.current + (index / (count * 2)) * Math.PI * 2 - Math.PI / 2;
        const length = 4 * ratio + level * level * reach;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        context.moveTo(cx + cos * inner, cy + sin * inner);
        context.lineTo(cx + cos * (inner + length), cy + sin * (inner + length));
        any = true;
      }
      if (!any) continue;
      context.globalAlpha = 0.35 + ((bucket + 0.5) / ALPHA_BUCKETS) * 0.65;
      context.stroke();
    }
    context.globalAlpha = 1;

    // The cover keeps its size (an image resized every frame is re-scaled every frame); the pulse is a transform.
    const coverBox = coverRef.current;
    if (coverBox) {
      const size = Math.round((base * 2) / ratio);
      if (size !== coverSize.current) {
        coverSize.current = size;
        coverBox.style.width = `${size}px`;
        coverBox.style.height = `${size}px`;
      }
      coverBox.style.transform = `translate(-50%, -50%) scale(${growth.toFixed(3)})`;
    }
  }, props.playing, fps);

  const className = ["visualizer", clipShown ? "with-clip" : "", lite ? "is-lite" : ""].filter(Boolean).join(" ");
  return (
    <div className={className} role="dialog" aria-label={props.title}>
      {props.cover ? <div className="visualizer-backdrop" style={{ backgroundImage: `url("${props.cover}")` }} /> : null}
      {props.clipKey ? (
        <ClipLoop key={props.clipKey} videoKey={props.clipKey} playing={props.playing} onVisible={setClipShown} onError={props.onClipError} />
      ) : null}
      <div className="clip-shade" />
      <canvas ref={canvasRef} />
      <div className="visualizer-cover" ref={coverRef}>
        {props.cover ? <img src={props.cover} alt="" /> : <div className="face" />}
      </div>
      <div className="visualizer-caption">
        {props.cover ? <img className="caption-cover" src={props.cover} alt="" /> : null}
        <div>
          <div>{props.title}</div>
          <small className="muted">{props.artist}</small>
          {props.notice}
        </div>
      </div>
      <div className="visualizer-actions">
        {props.actions ?? (
          <button className="text-button" type="button" onClick={props.onClose}>
            {props.closeLabel}
          </button>
        )}
      </div>
      {props.controls ? <div className="visualizer-controls">{props.controls}</div> : null}
    </div>
  );
}
