import type Hls from "hls.js";
import { attachHls, detectCapabilities } from "@kinora/client";
import type { AudioTrackInfo, PlayerAdapter, PlayerBackend, PlayerCallbacks, PlayerSource } from "./types";

/** The non-standard AudioTrackList of TV browsers (Tizen, webOS); desktop Chromium hides it behind a flag. */
type NativeAudioTrack = { id: string; language: string; label: string; enabled: boolean };
type NativeAudioTracks = { length: number; [index: number]: NativeAudioTrack };

function nativeTracks(video: HTMLVideoElement): NativeAudioTracks | null {
  return (video as unknown as { audioTracks?: NativeAudioTracks }).audioTracks ?? null;
}

function createHtml5Player(video: HTMLVideoElement, callbacks: PlayerCallbacks): PlayerAdapter {
  let detach: (() => void) | undefined;
  let hls: Hls | null = null;

  function unload() {
    detach?.();
    detach = undefined;
    hls = null;
    if (video.getAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
  }

  return {
    load(source: PlayerSource) {
      unload();
      if (source.kind === "file") {
        video.src = source.url;
        return;
      }
      detach = attachHls(video, source.url, {
        start: source.start,
        onFatal: callbacks.onFatal,
        onUnsupported: callbacks.onUnsupported,
        onHls: (player) => {
          hls = player;
        },
      });
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
      return video.duration;
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
      unload();
    },
  };
}

export const html5Backend: PlayerBackend = {
  name: "html5",
  capabilities: detectCapabilities,
  create: createHtml5Player,
};
