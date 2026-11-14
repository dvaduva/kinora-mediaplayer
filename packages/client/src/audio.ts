import type { TrackClip } from "@kinora/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, getApiConfig } from "./api";
import { streamUrl } from "./urls";

/** A track handed to the audio engine. */
export type NowPlaying = {
  fileId: string;
  title: string;
  artist: string;
  cover: string | null;
  clip?: TrackClip | null;
};

export type AudioClips = Record<string, TrackClip | null | undefined>;

export type AudioEngineOptions = {
  /**
   * Starts optimistically: `playing` and the visualizer turn on as soon as a track starts
   * (so a muted YouTube clip can autoplay), and a track that fails to start is skipped.
   */
  optimistic?: boolean;
  /**
   * Against a cross-origin server with a token, fetch the stream with a Bearer header into a
   * blob URL (revoked on the next track). Same-origin always uses the plain stream URL, synchronously.
   */
  fetchCrossOrigin?: boolean;
};

export type AudioPosition = { index: number; total: number };

/** Plain stream URL when same-origin; otherwise a Bearer-fetched blob URL (async). */
function resolveSource(fileId: string, fetchCrossOrigin: boolean): string | Promise<string> {
  const url = streamUrl(fileId);
  if (!fetchCrossOrigin) return url;
  const { baseUrl, token } = getApiConfig();
  // Same-origin uses the session cookie; cross-origin needs a Bearer-fetched blob.
  if (!baseUrl || !token) return url;
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => {
    if (!response.ok) throw new Error("stream_failed");
    return URL.createObjectURL(await response.blob());
  });
}

function sameClip(a: TrackClip | null | undefined, b: TrackClip | null | undefined) {
  return a?.key === b?.key && a?.kind === b?.kind;
}

/**
 * Headless music player: queue, Web Audio analyser, progress reporting. The caller renders
 * the `<audio ref={audioRef} {...audioProps} />` element and its own UI. Returned callbacks are stable.
 */
export function useAudioEngine(options: AudioEngineOptions = {}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentRef = useRef<NowPlaying | null>(null);
  const queueRef = useRef<{ tracks: NowPlaying[]; index: number }>({ tracks: [], index: -1 });
  const objectUrlRef = useRef<string | null>(null);
  const graphRef = useRef<AudioContext | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [current, setCurrent] = useState<NowPlaying | null>(null);
  const [position, setPosition] = useState<AudioPosition>({ index: -1, total: 0 });
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [visual, setVisual] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  function clearObjectUrl() {
    if (!objectUrlRef.current) return;
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }

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
    const { optimistic = false, fetchCrossOrigin = false } = optionsRef.current;
    currentRef.current = track;
    setCurrent(track);
    setActive(true);
    if (optimistic) {
      // ClipLoop mounts while "playing" so muted YouTube autoplay is not paused onReady.
      setPlaying(true);
      setVisual(true);
    }
    setPosition({ index: queueRef.current.index, total: queueRef.current.tracks.length });
    const audio = audioRef.current;
    if (!audio) return;
    clearObjectUrl();
    const fail = () => {
      if (!optimistic) return;
      setPlaying(false);
      step(1);
    };
    const begin = (src: string) => {
      ensureGraph();
      audio.src = src;
      void audio.play().catch(fail);
    };
    let source: string | Promise<string>;
    try {
      source = resolveSource(track.fileId, fetchCrossOrigin);
    } catch {
      fail();
      return;
    }
    // Same-origin stays synchronous so play() and the AudioContext keep the user gesture.
    if (typeof source === "string") {
      begin(source);
      return;
    }
    source.then(
      (src) => {
        if (src.startsWith("blob:")) objectUrlRef.current = src;
        if (currentRef.current?.fileId !== track.fileId) return;
        begin(src);
      },
      fail,
    );
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

  function previous() {
    const audio = audioRef.current;
    // Like most players: a few seconds in, "previous" restarts the current track.
    if (audio && (audio.currentTime > 3 || !step(-1))) audio.currentTime = 0;
  }

  function pause() {
    audioRef.current?.pause();
  }

  /** Ends the music: the player and its bar go away until the next play(). */
  function stop() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    clearObjectUrl();
    queueRef.current = { tracks: [], index: -1 };
    currentRef.current = null;
    setCurrent(null);
    setPlaying(false);
    setVisual(false);
    setActive(false);
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio || !currentRef.current) return;
    if (audio.paused) {
      ensureGraph();
      void audio.play().catch(() => undefined);
    } else audio.pause();
  }

  /** Attaches YouTube clips that arrived after playback started (keyed by file id). */
  function attachClips(byFileId: AudioClips) {
    const queue = queueRef.current;
    let touched = false;
    queue.tracks = queue.tracks.map((track) => {
      if (!(track.fileId in byFileId)) return track;
      const clip = byFileId[track.fileId] ?? null;
      if (sameClip(track.clip, clip)) return track;
      touched = true;
      return { ...track, clip };
    });
    const playingTrack = currentRef.current;
    if (playingTrack && playingTrack.fileId in byFileId) {
      const clip = byFileId[playingTrack.fileId] ?? null;
      if (!sameClip(playingTrack.clip, clip)) {
        const next = { ...playingTrack, clip };
        currentRef.current = next;
        setCurrent(next);
        touched = true;
      }
    }
    if (touched) setPosition({ index: queue.index, total: queue.tracks.length });
  }

  // Listeners and the returned callbacks are created once, so they reach the latest functions through a ref.
  const impl = { play, pause, stop, toggle, previous, step, attachClips, ensureGraph };
  const implRef = useRef(impl);
  implRef.current = impl;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // On the end of a track, or a file that will not play, move on through the queue.
    const advance = () => {
      if (!implRef.current.step(1)) setActive(false);
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

  const actions = useMemo(
    () => ({
      /** Plays `track`; with `queue` (e.g. the whole album), carries on through the tracks after it. */
      play: (track: NowPlaying, queue?: NowPlaying[]) => implRef.current.play(track, queue),
      pause: () => implRef.current.pause(),
      stop: () => implRef.current.stop(),
      toggle: () => implRef.current.toggle(),
      previous: () => implRef.current.previous(),
      next: () => {
        implRef.current.step(1);
      },
      step: (delta: number) => implRef.current.step(delta),
      attachClips: (byFileId: AudioClips) => implRef.current.attachClips(byFileId),
      /** Handlers for the `<audio>` element. */
      audioProps: {
        onPlay: () => {
          implRef.current.ensureGraph();
          setPlaying(true);
        },
        onPause: () => setPlaying(false),
        onEnded: () => setPlaying(false),
      },
    }),
    [],
  );

  return { audioRef, current, position, active, playing, visual, setVisual, analyser, ...actions };
}
