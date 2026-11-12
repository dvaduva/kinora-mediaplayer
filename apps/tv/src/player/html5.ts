import type Hls from "hls.js";
import { attachHls, detectCapabilities, getApiConfig } from "@kinora/client";
import { playerUrl } from "./bridge";
import type { AudioTrackInfo, PlayerAdapter, PlayerBackend, PlayerCallbacks, PlayerSource } from "./types";

/** The non-standard AudioTrackList of TV browsers (Tizen, webOS); desktop Chromium hides it behind a flag. */
type NativeAudioTrack = { id: string; language: string; label: string; enabled: boolean };
type NativeAudioTracks = { length: number; [index: number]: NativeAudioTrack };

function nativeTracks(video: HTMLVideoElement): NativeAudioTracks | null {
  return (video as unknown as { audioTracks?: NativeAudioTracks }).audioTracks ?? null;
}

export type Html5Options = {
  /**
   * HLS goes to the <video> itself instead of hls.js (webOS: LG's pipeline plays HLS with HEVC and Dolby
   * audio, which hls.js on MSE cannot). The token travels in the URL, since the element sends no headers.
   */
  nativeHls?: boolean;
  /** Pauses when the app goes to the background (Home, another input), as webOS asks apps to. */
  pauseWhenHidden?: boolean;
};

/** How far past the start point a native HLS player may land before it is sent back (it may open at the live edge). */
const START_SLACK = 8;

/**
 * Set once the TV's own HLS player failed before showing a frame: from then on, for the life of the page,
 * converted streams go through hls.js, which is known to work (H.264 at least).
 */
let nativeHlsBroken = false;

/**
 * Plays an HLS stream in the element itself, from `start`. Returns the cleanup.
 * `onError` learns whether the stream had started playing when it failed.
 */
function attachNativeHls(video: HTMLVideoElement, url: string, start: number, onFailed: (played: boolean) => void) {
  let corrections = 0;
  let played = false;
  const toStart = () => {
    if (start > 0 && corrections < 3 && Math.abs(video.currentTime - start) > START_SLACK) {
      corrections += 1;
      video.currentTime = start;
    }
  };
  const onMeta = () => {
    toStart();
    void video.play().catch(() => undefined);
  };
  const onPlaying = () => {
    toStart();
    corrections = 3;
    played = true;
  };
  const onError = () => onFailed(played);
  video.addEventListener("loadedmetadata", onMeta);
  video.addEventListener("playing", onPlaying);
  video.addEventListener("error", onError);
  video.src = playerUrl(url, getApiConfig().token || null);
  return () => {
    video.removeEventListener("loadedmetadata", onMeta);
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("error", onError);
  };
}

export function createHtml5Player(video: HTMLVideoElement, callbacks: PlayerCallbacks, options: Html5Options = {}): PlayerAdapter {
  let detach: (() => void) | undefined;
  let hls: Hls | null = null;
  let nativeStream = false;
  const onVisibility = () => {
    if (document.hidden && !video.paused) video.pause();
  };
  if (options.pauseWhenHidden) document.addEventListener("visibilitychange", onVisibility);

  function unload() {
    detach?.();
    detach = undefined;
    hls = null;
    nativeStream = false;
    if (video.getAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
  }

  function attachHlsJs(source: Extract<PlayerSource, { kind: "hls" }>) {
    detach = attachHls(video, source.url, {
      start: source.start,
      onFatal: callbacks.onFatal,
      onUnsupported: callbacks.onUnsupported,
      onHls: (player) => {
        hls = player;
      },
    });
  }

  return {
    load(source: PlayerSource) {
      unload();
      if (source.kind === "file") {
        video.src = source.url;
        return;
      }
      if (options.nativeHls && !nativeHlsBroken) {
        nativeStream = true;
        detach = attachNativeHls(video, source.url, source.start, (played) => {
          if (played) return callbacks.onFatal();
          // Never showed a frame: the TV's HLS player is the problem, not the stream. Retry it with hls.js.
          console.warn("[kinora] native HLS failed before playing; falling back to hls.js");
          nativeHlsBroken = true;
          unload();
          attachHlsJs(source);
        });
        return;
      }
      attachHlsJs(source);
    },
    unload,
    play() {
      void video.play().catch(() => undefined);
    },
    pause() {
      video.pause();
    },
    seek(seconds: number) {
      video.currentTime = seconds;
    },
    get currentTime() {
      return video.currentTime || 0;
    },
    get duration() {
      const duration = video.duration;
      if (!nativeStream || Number.isFinite(duration)) return duration;
      // A growing transcode is a live stream to the native player: what is converted so far is seekable.
      try {
        const seekable = video.seekable;
        if (seekable.length > 0) return seekable.end(seekable.length - 1);
      } catch {
        // no ranges yet
      }
      return Number.NaN;
    },
    get paused() {
      return video.paused;
    },
    audioTracks(): AudioTrackInfo[] {
      if (hls) {
        return hls.audioTracks.map((track, index) => ({
          id: String(index),
          language: track.lang ?? null,
          label: track.name || track.lang || `${index + 1}`,
          enabled: index === hls!.audioTrack,
        }));
      }
      const tracks = nativeTracks(video);
      const list: AudioTrackInfo[] = [];
      for (let index = 0; tracks && index < tracks.length; index += 1) {
        const track = tracks[index]!;
        list.push({ id: track.id || String(index), language: track.language || null, label: track.label || track.language || `${index + 1}`, enabled: track.enabled });
      }
      return list;
    },
    selectAudioTrack(id: string) {
      if (hls) {
        hls.audioTrack = Number(id);
        return;
      }
      const tracks = nativeTracks(video);
      for (let index = 0; tracks && index < tracks.length; index += 1) {
        const track = tracks[index]!;
        track.enabled = (track.id || String(index)) === id;
      }
    },
    on(event, handler) {
      video.addEventListener(event, handler);
      return () => video.removeEventListener(event, handler);
    },
    destroy() {
      document.removeEventListener("visibilitychange", onVisibility);
      unload();
    },
  };
}

export const html5Backend: PlayerBackend = {
  name: "html5",
  capabilities: detectCapabilities,
  textTracks: true,
  create: createHtml5Player,
};
