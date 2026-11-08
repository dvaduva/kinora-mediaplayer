import { useCallback, useEffect, useRef, useState } from "react";
import { ClipLoop } from "./clipLoop";

const BRASS = [210, 174, 98] as const;

/** Splits the analyser's linear bins into log-spaced bands, 0..1 each. */
function bands(data: Uint8Array, count: number, out: Float32Array) {
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

function bass(data: Uint8Array) {
  let sum = 0;
  for (let bin = 1; bin < 8; bin += 1) sum += data[bin] ?? 0;
  return sum / (7 * 255);
}

function useFrames(analyser: AnalyserNode | null, draw: (data: Uint8Array) => void) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      drawRef.current(data);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);
}

function fitCanvas(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
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
    // Lows in the middle, highs toward both edges.
    const level = levels[index < count ? count - 1 - index : index - count] ?? 0;
    const bar = 2 * ratio + level * level * reach;
    context.fillStyle = `rgba(${BRASS.join(",")},${0.45 + level * 0.55})`;
    context.fillRect(index * step + step * 0.2, height - bar, step * 0.6, bar);
  }
}

/** Small spectrum strip for the now-playing bar. */
export function MiniSpectrum(props: { analyser: AnalyserNode | null; onClick: () => void; label: string }) {
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
  });
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
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const levels = useRef(new Float32Array(96));
  const smoothBass = useRef(0);
  const rotation = useRef(0);
  const calm = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [shownFor, setShownFor] = useState<string | null>(null);
  // Tied to the clip it was reported for, so a track without a clip (or a new
  // clip still loading) falls back to the cover view instead of a stale state.
  const clipShown = props.clipKey != null && shownFor === props.clipKey;
  const clipKey = props.clipKey;
  const setClipShown = useCallback((visible: boolean) => setShownFor(visible ? clipKey : null), [clipKey]);
  const stripRef = useRef(false);
  stripRef.current = clipShown;
  const { onClose } = props;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useFrames(props.analyser, (data) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { width, height, ratio } = fitCanvas(canvas);
    const count = levels.current.length;
    bands(data, count, levels.current);
    const low = bass(data);
    smoothBass.current += (low - smoothBass.current) * 0.25;
    const pulse = calm.current ? 0 : smoothBass.current;
    if (!calm.current) rotation.current += 0.0015 + pulse * 0.01;

    if (stripRef.current) {
      drawStrip(context, width, height, ratio, levels.current);
      return;
    }

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.2 * (1 + pulse * 0.08);
    const reach = Math.min(width, height) * 0.16;

    context.clearRect(0, 0, width, height);
    const glow = context.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius + reach * 1.6);
    glow.addColorStop(0, `rgba(${BRASS.join(",")},${0.08 + smoothBass.current * 0.35})`);
    glow.addColorStop(1, "rgba(20,18,26,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    context.lineCap = "round";
    context.lineWidth = Math.max(2, ((Math.PI * 2 * radius) / (count * 2)) * 0.55);
    for (let index = 0; index < count * 2; index += 1) {
      // Mirror the spectrum so low frequencies sit at the top and bottom, highs at the sides.
      const level = levels.current[index < count ? index : count * 2 - 1 - index] ?? 0;
      const angle = rotation.current + (index / (count * 2)) * Math.PI * 2 - Math.PI / 2;
      const length = 4 * ratio + level * level * reach;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      context.strokeStyle = `rgba(${BRASS.join(",")},${0.35 + level * 0.65})`;
      context.beginPath();
      context.moveTo(cx + cos * (radius + 6 * ratio), cy + sin * (radius + 6 * ratio));
      context.lineTo(cx + cos * (radius + 6 * ratio + length), cy + sin * (radius + 6 * ratio + length));
      context.stroke();
    }

    const coverBox = coverRef.current;
    if (coverBox) {
      const size = (radius * 2) / ratio;
      coverBox.style.width = `${size}px`;
      coverBox.style.height = `${size}px`;
    }
  });

  return (
    <div className={clipShown ? "visualizer with-clip" : "visualizer"} role="dialog" aria-label={props.title}>
      {props.cover ? <div className="visualizer-backdrop" style={{ backgroundImage: `url("${props.cover}")` }} /> : null}
      {props.clipKey ? <ClipLoop key={props.clipKey} videoKey={props.clipKey} playing={props.playing} onVisible={setClipShown} /> : null}
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
        </div>
      </div>
      <div className="visualizer-actions">
        <button className="text-button" type="button" onClick={props.onClose}>{props.closeLabel}</button>
      </div>
    </div>
  );
}
