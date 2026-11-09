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
    element: HTMLElement | string,
    options: {
      host?: string;
      videoId?: string;
      width?: string | number;
      height?: string | number;
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
const BUFFERING = 3;
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

function embedUrl(videoKey: string) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    disablekb: "1",
    fs: "0",
    iv_load_policy: "3",
    modestbranding: "1",
    playsinline: "1",
    rel: "0",
    cc_load_policy: "0",
    loop: "1",
    playlist: videoKey,
    enablejsapi: "1",
    origin: window.location.origin,
    widget_referrer: window.location.href,
  });
  // nocookie + referrerpolicy clears YouTube error 153 for many hosts.
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoKey)}?${params}`;
}

/**
 * A muted, chrome-less excerpt of a YouTube clip playing on repeat behind the
 * music. The sound always comes from the library file; this is picture only.
 *
 * Builds the iframe with referrerpolicy before src so YouTube gets a Referer.
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

    const host = hostRef.current;
    if (!host) return;

    const iframe = document.createElement("iframe");
    iframe.title = "Music video";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.setAttribute("allowfullscreen", "true");
    iframe.src = embedUrl(props.videoKey);
    host.append(iframe);
    setVisible(true);

    const ensureSegment = (player: YTPlayer) => {
      if (segment) return segment;
      const duration = player.getDuration();
      if (!duration) return null;
      const start = duration > LOOP_SECONDS * 3 ? Math.floor(duration * LOOP_AT) : 0;
      segment = { start, end: Math.min(duration - 0.5, start + LOOP_SECONDS) };
      player.seekTo(start, true);
      return segment;
    };

    const syncPlayback = (player: YTPlayer) => {
      player.mute();
      if (playingRef.current) player.playVideo();
      else player.pauseVideo();
    };

    loadYoutubeApi()
      .then((YT) => {
        if (disposed || !host.contains(iframe)) return;
        const player = new YT.Player(iframe, {
          events: {
            onReady: (event) => {
              ensureSegment(event.target);
              syncPlayback(event.target);
              if (!disposed) setVisible(true);
            },
            onStateChange: (event) => {
              if (event.data === PLAYING || event.data === BUFFERING) {
                ensureSegment(event.target);
                hideCaptions(event.target);
                if (!disposed) setVisible(true);
              }
              if (event.data === ENDED) {
                const current = ensureSegment(event.target);
                if (current) {
                  event.target.seekTo(current.start, true);
                  event.target.playVideo();
                }
              }
            },
            // 101/150/153: embed blocked; keep the cover visualizer.
            onError: () => {
              if (!disposed) setVisible(false);
            },
          },
        });
        playerRef.current = player;
        timer = window.setInterval(() => {
          if (typeof player.getCurrentTime !== "function" || typeof player.getPlayerState !== "function") return;
          const state = player.getPlayerState();
          if (state === PLAYING || state === BUFFERING) {
            ensureSegment(player);
            setVisible(true);
          }
          const current = ensureSegment(player);
          if (!current) return;
          const time = player.getCurrentTime();
          if (time >= current.end || time < current.start - 1) player.seekTo(current.start, true);
          if (playingRef.current && state !== PLAYING && state !== BUFFERING) player.playVideo();
        }, 200);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      try {
        playerRef.current?.destroy();
      } catch {
        // Player may already be gone with the iframe.
      }
      playerRef.current = null;
      host.textContent = "";
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
