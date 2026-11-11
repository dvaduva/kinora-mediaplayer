import type { TrackClip } from "@kinora/shared";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { api, getConnection } from "./api";
import { Focusable } from "./components/Focusable";
import { useLocale } from "./i18n";
import { imageUrl, streamUrl } from "@kinora/client";
import { MiniSpectrum, Visualizer } from "@kinora/media-ui";

export type NowPlaying = {
  fileId: string;
  title: string;
  artist: string;
  cover: string | null;
  clip?: TrackClip | null;
};

type AudioApi = {
  play: (track: NowPlaying, queue?: NowPlaying[]) => void;
  pause: () => void;
  toggle: () => void;
  previous: () => void;
  next: () => void;
  attachClips: (byFileId: Record<string, TrackClip | null | undefined>) => void;
  current: NowPlaying | null;
  playing: boolean;
  active: boolean;
};

const AudioCtx = createContext<AudioApi | null>(null);

async function resolveSrc(fileId: string) {
  const { baseUrl, token } = getConnection();
  const url = streamUrl(fileId);
  // Same-origin uses the session cookie; cross-origin needs a Bearer-fetched blob.
  if (!baseUrl || !token) return url;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("stream_failed");
  return URL.createObjectURL(await response.blob());
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentRef = useRef<NowPlaying | null>(null);
  const queueRef = useRef<{ tracks: NowPlaying[]; index: number }>({ tracks: [], index: -1 });
  const objectUrlRef = useRef<string | null>(null);
  const graphRef = useRef<AudioContext | null>(null);
  const [current, setCurrent] = useState<NowPlaying | null>(null);
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [visual, setVisual] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [position, setPosition] = useState({ index: -1, total: 0 });
  const location = useLocation();
  const { t } = useLocale();

  // Video / live players take over the screen — pause music so both don't fight.
  useEffect(() => {
    if (!location.pathname.startsWith("/play/") && !location.pathname.startsWith("/live/")) return;
    audioRef.current?.pause();
    setVisual(false);
  }, [location.pathname]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
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
    const progress = window.setInterval(send, 5000);
    return () => {
      audio.removeEventListener("pause", send);
      audio.removeEventListener("ended", send);
      window.clearInterval(progress);
    };
  }, []);

  function clearObjectUrl() {
    if (!objectUrlRef.current) return;
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }

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

  async function start(track: NowPlaying) {
    currentRef.current = track;
    setCurrent(track);
    setActive(true);
    // Optimistic: ClipLoop mounts while "playing" so muted YouTube autoplay is not paused onReady.
    setPlaying(true);
    setVisual(true);
    setPosition({ index: queueRef.current.index, total: queueRef.current.tracks.length });
    const audio = audioRef.current;
    if (!audio) return;
    clearObjectUrl();
    try {
      const src = await resolveSrc(track.fileId);
      if (src.startsWith("blob:")) objectUrlRef.current = src;
      if (currentRef.current?.fileId !== track.fileId) return;
      ensureGraph();
      audio.src = src;
      await audio.play();
    } catch {
      setPlaying(false);
      stepRef.current(1);
    }
  }

  function play(track: NowPlaying, queue?: NowPlaying[]) {
    const tracks = queue && queue.length > 0 ? queue : [track];
    const index = tracks.findIndex((entry) => entry.fileId === track.fileId);
    queueRef.current = index >= 0 ? { tracks, index } : { tracks: [track], index: 0 };
    void start(track);
  }

  function step(delta: number) {
    const queue = queueRef.current;
    const next = queue.tracks[queue.index + delta];
    if (!next) return false;
    queue.index += delta;
    void start(next);
    return true;
  }

  const stepRef = useRef(step);
  stepRef.current = step;

  function previous() {
    const audio = audioRef.current;
    if (audio && (audio.currentTime > 3 || !step(-1))) audio.currentTime = 0;
  }

  function pause() {
    audioRef.current?.pause();
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio || !currentRef.current) return;
    if (audio.paused) {
      ensureGraph();
      void audio.play().catch(() => undefined);
    } else audio.pause();
  }

  function attachClips(byFileId: Record<string, TrackClip | null | undefined>) {
    const queue = queueRef.current;
    queue.tracks = queue.tracks.map((track) => (track.fileId in byFileId ? { ...track, clip: byFileId[track.fileId] ?? null } : track));
    const playingTrack = currentRef.current;
    if (playingTrack && playingTrack.fileId in byFileId) {
      const next = { ...playingTrack, clip: byFileId[playingTrack.fileId] ?? null };
      currentRef.current = next;
      setCurrent(next);
    }
  }

  const playRef = useRef(play);
  playRef.current = play;
  const pauseRef = useRef(pause);
  pauseRef.current = pause;
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const previousRef = useRef(previous);
  previousRef.current = previous;
  const attachClipsRef = useRef(attachClips);
  attachClipsRef.current = attachClips;

  const apiValue = useMemo<AudioApi>(
    () => ({
      play: (track, queue) => playRef.current(track, queue),
      pause: () => pauseRef.current(),
      toggle: () => toggleRef.current(),
      previous: () => previousRef.current(),
      next: () => {
        void stepRef.current(1);
      },
      attachClips: (byFileId) => attachClipsRef.current(byFileId),
      current,
      playing,
      active,
    }),
    [current, playing, active],
  );

  const cover = current?.cover ? imageUrl(current.cover, "w500") : null;
  const clipKey = current?.clip?.kind === "video" ? current.clip.key : null;

  return (
    <AudioCtx.Provider value={apiValue}>
      {children}
      <audio
        ref={audioRef}
        onPlay={() => {
          ensureGraph();
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      {active && current ? (
        <>
          <div className={`now-bar${visual ? " is-hidden" : ""}`}>
            <Focusable className="now-face" focusKey="now-expand" onEnterPress={() => setVisual(true)}>
              {cover ? <img src={cover} alt="" /> : <div className="now-face-empty" />}
              <div>
                <small>{t.nowPlaying}</small>
                <strong>{current.title}</strong>
                <span>{current.artist}</span>
              </div>
            </Focusable>
            <div className="now-controls">
              <Focusable className="btn now-btn" focusKey="now-prev" onEnterPress={previous}>
                ‹
              </Focusable>
              <Focusable className="btn primary now-btn" focusKey="now-toggle" onEnterPress={toggle}>
                {playing ? t.pause : t.play}
              </Focusable>
              <Focusable
                className="btn now-btn"
                focusKey="now-next"
                onEnterPress={() => {
                  void step(1);
                }}
              >
                ›
              </Focusable>
            </div>
            {analyser ? (
              <MiniSpectrum
                analyser={visual ? null : analyser}
                onClick={() => setVisual(true)}
                label={clipKey ? t.visualizeClip : t.visualize}
              />
            ) : null}
            {position.total > 1 ? (
              <small className="now-count">
                {position.index + 1}/{position.total}
              </small>
            ) : null}
          </div>

          {visual ? (
            <Visualizer
              analyser={analyser}
              cover={cover}
              title={current.title}
              artist={current.artist}
              clipKey={clipKey}
              playing={playing}
              closeLabel={t.close}
              onClose={() => setVisual(false)}
              actions={
                <Focusable className="btn" focusKey="visual-close" onEnterPress={() => setVisual(false)}>
                  {t.close}
                </Focusable>
              }
              controls={
                <>
                  <Focusable className="btn" focusKey="visual-prev" onEnterPress={previous}>
                    {t.previousTrack}
                  </Focusable>
                  <Focusable className="btn primary" focusKey="visual-toggle" focusOnMount onEnterPress={toggle}>
                    {playing ? t.pause : t.play}
                  </Focusable>
                  <Focusable
                    className="btn"
                    focusKey="visual-next"
                    onEnterPress={() => {
                      void step(1);
                    }}
                  >
                    {t.nextTrack}
                  </Focusable>
                </>
              }
            />
          ) : null}
        </>
      ) : null}
    </AudioCtx.Provider>
  );
}

export function useAudio() {
  const value = useContext(AudioCtx);
  if (!value) throw new Error("AudioProvider missing");
  return value;
}
