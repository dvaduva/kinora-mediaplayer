import { useEffect, useRef, useState } from "react";

/** Length of the looped excerpt, in seconds. */
const LOOP_SECONDS = 12;
/** Where the excerpt starts, as a share of the clip: past intros and label cards. */
const LOOP_AT = 0.35;

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  loadVideoById(videoId: string): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

export interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      host?: string;
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (event: { target: YTPlayer }) => void;
        onStateChange?: (event: { target: YTPlayer; data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * cc_load_policy=0 does not override a viewer who turned captions on in YouTube,
 * and lyrics captions on top of the picture would clash with the music.
 * unloadModule is undocumented, so it is optional.
 */
export function hideCaptions(player: YTPlayer) {
  const withModules = player as YTPlayer & { unloadModule?: (name: string) => void };
  try {
    withModules.unloadModule?.("captions");
    withModules.unloadModule?.("cc");
  } catch {
    // Captions stay; the loop still works.
  }
}

const PLAYING = 1;
const ENDED = 0;

let apiPromise: Promise<YTNamespace> | null = null;

export function loadYoutubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("youtube_api"));
    };
    document.head.append(script);
  });
  return apiPromise;
}

/**
 * A muted, chrome-less excerpt of a YouTube clip playing on repeat behind the
 * music, the way streaming apps show a short canvas. The sound always comes
 * from the library file; this is picture only.
 */
export function ClipLoop(props: { videoKey: string; playing: boolean; onVisible: (visible: boolean) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const playingRef = useRef(props.playing);
  playingRef.current = props.playing;
  const [visible, setVisible] = useState(false);
  const { onVisible } = props;

  useEffect(() => onVisible(visible), [visible, onVisible]);

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let segment: { start: number; end: number } | null = null;
    setVisible(false);

    // Picks the excerpt once the duration is known (it is often 0 until playback starts).
    const ensureSegment = (player: YTPlayer) => {
      if (segment) return segment;
      const duration = player.getDuration();
      if (!duration) return null;
      const start = duration > LOOP_SECONDS * 3 ? Math.floor(duration * LOOP_AT) : 0;
      segment = { start, end: Math.min(duration - 0.5, start + LOOP_SECONDS) };
      player.seekTo(start, true);
      return segment;
    };

    loadYoutubeApi()
      .then((YT) => {
        if (disposed || !hostRef.current) return;
        const mount = document.createElement("div");
        hostRef.current.append(mount);
        const player = new YT.Player(mount, {
          host: "https://www.youtube-nocookie.com",
          videoId: props.videoKey,
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            cc_load_policy: 0,
          },
          events: {
            onReady: (event) => {
              event.target.mute();
              ensureSegment(event.target);
              if (playingRef.current) event.target.playVideo();
            },
            onStateChange: (event) => {
              if (event.data === PLAYING) {
                ensureSegment(event.target);
                hideCaptions(event.target);
              }
              if (event.data === ENDED && segment) {
                event.target.seekTo(segment.start, true);
                event.target.playVideo();
              }
            },
            // 101/150: the owner blocks embedding; anything else is just as fatal here.
            onError: () => {
              if (!disposed) setVisible(false);
            },
          },
        });
        playerRef.current = player;
        timer = window.setInterval(() => {
          const current = segment;
          if (!current || typeof player.getCurrentTime !== "function") return;
          const time = player.getCurrentTime();          if (time >= current.end || time < current.start - 1) player.seekTo(current.start, true);
          // Only reveal once we are inside the excerpt, so YouTube's loading frames never show.
          if (player.getPlayerState() === PLAYING && time >= current.start && time < current.end) setVisible(true);
        }, 200);
      })
      .catch(() => setVisible(false));

    return () => {
      disposed = true;
      window.clearInterval(timer);
      playerRef.current?.destroy();
      playerRef.current = null;
      if (hostRef.current) hostRef.current.textContent = "";
    };
  }, [props.videoKey]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || typeof player.playVideo !== "function") return;
    if (props.playing) player.playVideo();
    else player.pauseVideo();
  }, [props.playing]);

  return <div className={visible ? "clip-loop shown" : "clip-loop"} ref={hostRef} aria-hidden="true" />;
}
