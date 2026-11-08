import type { TrackClip } from "@kinora/shared";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { imageUrl } from "./media";
import { useLocale } from "./i18n";
import { MiniSpectrum, Visualizer } from "./visualizer";

interface NowPlaying {
  fileId: string;
  title: string;
  artist: string;
  cover: string | null;
  clip?: TrackClip | null;
}

const AudioContext = createContext<{
  /** Plays `track`; with `queue` (e.g. the whole album), carries on through the tracks after it. */
  play: (track: NowPlaying, queue?: NowPlaying[]) => void;
  pause: () => void;
  /** Attaches YouTube clips that arrived after playback started (keyed by file id). */
  attachClips: (byFileId: Record<string, TrackClip | null | undefined>) => void;
} | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentRef = useRef<NowPlaying | null>(null);
  const queueRef = useRef<{ tracks: NowPlaying[]; index: number }>({ tracks: [], index: -1 });
  const [current, setCurrent] = useState<NowPlaying | null>(null);
  const [position, setPosition] = useState({ index: -1, total: 0 });
  const [active, setActive] = useState(false);
  const [visual, setVisual] = useState(false);
  const [playing, setPlaying] = useState(false);
  const graphRef = useRef<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const { t } = useLocale();
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // On the end of a track, or a file that will not play, move on through the queue.
    const advance = () => {
      if (!stepRef.current(1)) setActive(false);
    };
    audio.addEventListener("ended", advance);
    audio.addEventListener("error", advance);
    return () => {
      audio.removeEventListener("ended", advance);
      audio.removeEventListener("error", advance);
    };
  }, []);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const send = () => {
      const track = currentRef.current;
      if (!track || !audio.duration) return;
      void api("/api/playback/progress", {
        method: "POST",
        body: JSON.stringify({
          fileId: track.fileId,
          position: audio.currentTime,
          duration: audio.duration,
          subtitleChoice: null,
        }),
      }).catch(() => undefined);
    };
    audio.addEventListener("pause", send);
    audio.addEventListener("ended", send);
    const timer = window.setInterval(send, 5000);
    return () => {
      audio.removeEventListener("pause", send);
      audio.removeEventListener("ended", send);
      window.clearInterval(timer);
    };
  }, []);
  // Routes the <audio> element through an analyser so visuals follow the music.
  // Must run inside a user gesture, or the AudioContext stays suspended and the track is silent.
  function ensureGraph() {
    if (graphRef.current) {
      void graphRef.current.resume();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    try {
      const context = new window.AudioContext();
      const source = context.createMediaElementSource(audio);
      const node = context.createAnalyser();
      node.fftSize = 1024;
      node.smoothingTimeConstant = 0.78;
      source.connect(node);
      node.connect(context.destination);
      graphRef.current = context;
      setAnalyser(node);
    } catch {
      // No Web Audio: music still plays, just without visuals.
    }
  }
  function start(track: NowPlaying) {
    currentRef.current = track;
    setCurrent(track);
    setActive(true);
    setPosition({ index: queueRef.current.index, total: queueRef.current.tracks.length });
    const audio = audioRef.current;
    if (!audio) return;
    ensureGraph();
    audio.src = `/api/stream/${track.fileId}`;
    void audio.play().catch(() => undefined);
  }
  function play(track: NowPlaying, queue?: NowPlaying[]) {
    const tracks = queue && queue.length > 0 ? queue : [track];
    const index = tracks.findIndex((entry) => entry.fileId === track.fileId);
    queueRef.current = index >= 0 ? { tracks, index } : { tracks: [track], index: 0 };
    start(track);
  }
  /** Moves `delta` tracks through the queue; false when there is nothing there. */
  function step(delta: number) {
    const queue = queueRef.current;
    const next = queue.tracks[queue.index + delta];
    if (!next) return false;
    queue.index += delta;
    start(next);
    return true;
  }
  // The "ended" listener is registered once, so it reaches step through a ref.
  const stepRef = useRef(step);
  stepRef.current = step;
  function previous() {
    const audio = audioRef.current;
    // Like most players: a few seconds in, "previous" restarts the current track.
    if (audio && (audio.currentTime > 3 || !step(-1))) audio.currentTime = 0;
  }
  function pause() {
    audioRef.current?.pause();
  }
  function attachClips(byFileId: Record<string, TrackClip | null | undefined>) {
    const queue = queueRef.current;
    let touched = false;
    queue.tracks = queue.tracks.map((track) => {
      if (!(track.fileId in byFileId)) return track;
      const clip = byFileId[track.fileId] ?? null;
      if (track.clip?.key === clip?.key && track.clip?.kind === clip?.kind) return track;
      touched = true;
      return { ...track, clip };
    });
    const playing = currentRef.current;
    if (playing && playing.fileId in byFileId) {
      const clip = byFileId[playing.fileId] ?? null;
      if (playing.clip?.key !== clip?.key || playing.clip?.kind !== clip?.kind) {
        const next = { ...playing, clip };
        currentRef.current = next;
        setCurrent(next);
        touched = true;
      }
    }
    if (touched) setPosition({ index: queue.index, total: queue.tracks.length });
  }
  // Only real music videos make a good loop; plain uploads are usually a still image.
  const clipKey = current?.clip?.kind === "video" ? current.clip.key : null;
  return (
    <AudioContext.Provider value={{ play, pause, attachClips }}>
      {children}
      <div className="now" hidden={!active}>
        {current?.cover ? <img src={imageUrl(current.cover) ?? ""} alt="" /> : <div className="face" />}
        <div>
          <small className="muted">{t.nowPlaying}</small>
          <div>{current ? `${current.title}` : "—"}</div>
          {current ? <small className="muted">{current.artist}</small> : null}
        </div>
        {position.total > 1 ? (
          <div className="now-steps">
            <button type="button" onClick={previous} aria-label={t.previousTrack} title={t.previousTrack}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 2h2v12H3zM14 2v12L6 8z" fill="currentColor" /></svg>
            </button>
            <small className="muted">{position.index + 1}/{position.total}</small>
            <button type="button" onClick={() => step(1)} disabled={position.index >= position.total - 1} aria-label={t.nextTrack} title={t.nextTrack}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M11 2h2v12h-2zM2 2v12l8-6z" fill="currentColor" /></svg>
            </button>
          </div>
        ) : null}
        {analyser ? (
          <MiniSpectrum analyser={visual ? null : analyser} onClick={() => setVisual(true)} label={clipKey ? t.visualizeClip : t.visualize} />
        ) : null}
        <audio
          ref={audioRef}
          controls
          onPlay={() => {
            ensureGraph();
            setPlaying(true);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      </div>
      {visual && active && current ? (
        <Visualizer
          analyser={analyser}
          cover={current.cover ? imageUrl(current.cover) : null}
          title={current.title}
          artist={current.artist}
          clipKey={clipKey}
          playing={playing}
          closeLabel={t.close}
          onClose={() => setVisual(false)}
        />
      ) : null}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  const value = useContext(AudioContext);
  if (!value) throw new Error("audio");
  return value;
}
